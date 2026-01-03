import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, ScanLine } from 'lucide-react';
import Tesseract from 'tesseract.js';
import Fuse from 'fuse.js';
import { Spinner } from '../../components/Shared';

const REQUIRED_CONSECUTIVE_MATCHES = 3;
const MATCH_CONFIDENCE_THRESHOLD = 0.85; // Fuse.js score is 0-1, lower is better. 0.15 is a good starting point.
const SCAN_COOLDOWN = 5; // seconds

const CardScanner = ({ onCardScanned, showMessage }) => {
    const [isScanning, setIsScanning] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [status, setStatus] = useState('Ready to Scan');
    const [allCardNames, setAllCardNames] = useState([]);
    const [fuse, setFuse] = useState(null);
    const [videoDevices, setVideoDevices] = useState([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState('');
    
    const recentReads = useRef([]);
    const lastScanTime = useRef(0);

    const videoRef = useRef(null);
    const canvasRef = useRef(null);

    // Load all card names on component mount for fuzzy matching
    useEffect(() => {
        const fetchCardNames = async () => {
            try {
                const response = await fetch("https://api.scryfall.com/catalog/card-names");
                const data = await response.json();
                const names = data.data;
                setAllCardNames(names);
                setFuse(new Fuse(names, { threshold: 0.4 }));
                console.log(`Loaded ${names.length} card names for validation.`);
            } catch (error) {
                console.error("Failed to load card names:", error);
                showMessage("Could not load card name catalog for validation.", "error");
            }
        };
        fetchCardNames();
    }, [showMessage]);

    // Get available camera devices
    useEffect(() => {
        const getDevices = async () => {
            try {
                // We need to get permission first to get device labels
                await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                const devices = await navigator.mediaDevices.enumerateDevices();
                const videoInputs = devices.filter(device => device.kind === 'videoinput');
                setVideoDevices(videoInputs);
                if (videoInputs.length > 0) {
                    // Try to find a back camera first
                    const backCamera = videoInputs.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment'));
                    if (backCamera) {
                        setSelectedDeviceId(backCamera.deviceId);
                    } else {
                        setSelectedDeviceId(videoInputs[0].deviceId);
                    }
                }
            } catch (error) {
                console.error("Could not enumerate devices:", error);
            }
        };
        getDevices();
    }, []);

    const startScan = useCallback(async () => {
        if (!selectedDeviceId) {
            // Fallback if no device ID is selected (e.g., initial load on mobile)
             try {
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    video: { 
                        facingMode: { ideal: "environment" }, // Prefer back camera
                        width: { ideal: 1280 }, 
                        height: { ideal: 720 } 
                    } 
                });
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.play();
                    setIsScanning(true);
                    setStatus('Camera active');
                }
                return;
            } catch (err) {
                 console.error("Error accessing webcam:", err);
                 showMessage("Could not access webcam. Please grant permissions.", 'error');
                 return;
            }
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    deviceId: { exact: selectedDeviceId },
                    width: { ideal: 1280 }, 
                    height: { ideal: 720 } 
                } 
            });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play(); // Explicitly play the video stream
                setIsScanning(true);
                setStatus('Camera active');
            }
        } catch (err) {
            console.error("Error accessing webcam:", err);
            showMessage("Could not access webcam. Please grant permissions.", 'error');
        }
    }, [showMessage, selectedDeviceId]);

    const stopScan = useCallback(() => {
        if (videoRef.current && videoRef.current.srcObject) {
            videoRef.current.srcObject.getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }
        setIsScanning(false);
        setStatus('Ready to Scan');
    }, []);

    const validateReads = useCallback(() => {
        if (recentReads.current.length > REQUIRED_CONSECUTIVE_MATCHES) {
            recentReads.current.shift();
        }
        if (recentReads.current.length === REQUIRED_CONSECUTIVE_MATCHES && new Set(recentReads.current).size === 1) {
            const confidentRead = recentReads.current[0];
            setIsProcessing(true);
            setStatus(`Validated: ${confidentRead}! Fetching data...`);
            onCardScanned(confidentRead);
            lastScanTime.current = Date.now() / 1000;
            recentReads.current = [];
            setIsProcessing(false);
        }
    }, [onCardScanned]);

    // Continuously scan when camera is active
    useEffect(() => {
        let intervalId;
        if (isScanning && !isProcessing && fuse) {
            intervalId = setInterval(async () => {
                const isOnCooldown = (Date.now() / 1000 - lastScanTime.current) < SCAN_COOLDOWN;
                if (isOnCooldown) {
                    const cooldownTimeLeft = SCAN_COOLDOWN - (Date.now() / 1000 - lastScanTime.current);
                    setStatus(`Success! Cooldown: ${Math.ceil(cooldownTimeLeft)}s`);
                    return;
                }
                
                if (videoRef.current && videoRef.current.readyState >= 3 && canvasRef.current) { // Check if video has enough data
                    setStatus('Scanning...');
                    const video = videoRef.current;
                    const canvas = canvasRef.current;
                    const context = canvas.getContext('2d');
                    
                    const roi = { x: video.videoWidth * 0.2, y: video.videoHeight * 0.05, width: video.videoWidth * 0.6, height: video.videoHeight * 0.1 };
                    
                    canvas.width = roi.width;
                    canvas.height = roi.height;
                    
                    context.drawImage(video, roi.x, roi.y, roi.width, roi.height, 0, 0, roi.width, roi.height);

                    const imageDataUrl = canvas.toDataURL('image/jpeg');

                    try {
                        const { data: { text } } = await Tesseract.recognize(imageDataUrl, 'eng');
                        const cleanedText = text.trim().replace(/[^a-zA-Z\s,']/g, "");
                        
                        if (cleanedText.length > 2) {
                            const results = fuse.search(cleanedText);
                            if (results.length > 0) {
                                const bestMatch = results[0];
                                if (bestMatch.score < (1 - MATCH_CONFIDENCE_THRESHOLD)) {
                                    setStatus(`Found: ${bestMatch.item} (Confidence: ${Math.round((1 - bestMatch.score) * 100)}%)`);
                                    recentReads.current.push(bestMatch.item);
                                    validateReads();
                                }
                            }
                        }
                    } catch (error) {
                        console.warn("OCR failed for this frame:", error);
                    }
                }
            }, 500);
        }
        return () => clearInterval(intervalId);
    }, [isScanning, isProcessing, fuse, validateReads]);

    return (
        <div className="p-4 bg-gray-900/50 rounded-2xl border border-gray-700 flex flex-col items-center">
            {allCardNames.length === 0 ? <Spinner text="Loading card catalog..." /> :
            isScanning ? (
                <div className="flex flex-col items-center w-full">
                    <div className="relative w-full max-w-2xl rounded-lg overflow-hidden border-2 border-purple-500/50">
                        <video ref={videoRef} autoPlay playsInline className="w-full h-auto"></video>
                        <div className="absolute border-2 border-green-400 pointer-events-none" style={{ top: '5%', left: '20%', width: '60%', height: '10%' }}></div>
                    </div>
                    <p className="mt-4 text-lg font-semibold text-yellow-300">{status}</p>
                    <p className="text-sm text-gray-400">Align card title in the green box.</p>
                    <button onClick={stopScan} className="mt-4 flex items-center gap-2 px-6 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-500"><X size={20} /> Stop Scanner</button>
                </div>
            ) : (
                <div className="text-center space-y-4">
                     <div>
                        <label htmlFor="camera-select" className="block text-sm font-medium text-gray-300 mb-1">Select Camera</label>
                        <select 
                            id="camera-select"
                            value={selectedDeviceId}
                            onChange={(e) => setSelectedDeviceId(e.target.value)}
                            className="w-full p-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                        >
                            {videoDevices.map(device => (
                                <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${videoDevices.indexOf(device) + 1}`}</option>
                            ))}
                        </select>
                    </div>
                    <button onClick={startScan} className="flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-500 transform hover:scale-105 shadow-lg">
                        <ScanLine size={20} /> Start MTG Scanner
                    </button>
                    <p className="text-sm text-gray-400">The scanner will validate a card after 3 consecutive high-confidence reads.</p>
                </div>
            )}
            <canvas ref={canvasRef} className="hidden"></canvas>
        </div>
    );
};

export default CardScanner;