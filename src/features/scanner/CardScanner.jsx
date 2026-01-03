import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import Tesseract from 'tesseract.js';
import Fuse from 'fuse.js';

const REQUIRED_CONSECUTIVE_MATCHES = 2;
const MATCH_THRESHOLD = 0.15; // Fuse score: 0 is perfect match.
const SCAN_COOLDOWN = 3; 

const CardScanner = ({ onCardScanned, showMessage }) => {
    const [isScanning, setIsScanning] = useState(false);
    const [status, setStatus] = useState('Initializing...');
    const [allCardNames, setAllCardNames] = useState([]);
    const [fuse, setFuse] = useState(null);
    const [cameras, setCameras] = useState([]);
    const [activeCameraId, setActiveCameraId] = useState(null);
    
    const recentReads = useRef([]);
    const lastScanTime = useRef(0);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);

    // 1. Load Card Catalog
    useEffect(() => {
        const fetchCardNames = async () => {
            try {
                const response = await fetch("https://api.scryfall.com/catalog/card-names");
                const data = await response.json();
                setAllCardNames(data.data);
                setFuse(new Fuse(data.data, { threshold: 0.4 }));
                setStatus('Ready to Scan');
            } catch (error) {
                showMessage("Failed to load card database.", "error");
            }
        };
        fetchCardNames();
    }, [showMessage]);

    // 2. Initialize Camera Logic
    const startCamera = useCallback(async (deviceId = null) => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }

        try {
            const constraints = {
                video: {
                    deviceId: deviceId ? { exact: deviceId } : undefined,
                    facingMode: deviceId ? undefined : 'environment', // Prefer back camera on mobile
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            streamRef.current = stream;
            
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.onloadedmetadata = () => {
                    videoRef.current.play().catch(e => console.error("Play error:", e));
                    setIsScanning(true);
                    setStatus('Align text in the box');
                };
            }

            // Get list of cameras for the switcher
            const devices = await navigator.mediaDevices.enumerateDevices();
            setCameras(devices.filter(d => d.kind === 'videoinput'));

        } catch (err) {
            console.error("Camera Error:", err);
            showMessage("Camera access denied. Please check permissions.", "error");
        }
    }, [showMessage]);

    // Handle initial camera start
    useEffect(() => {
        if (allCardNames.length > 0 && !isScanning) {
            startCamera();
        }
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allCardNames]); 

    // Success Handler (Wrapped in useCallback to fix lint error)
    const handleScanSuccess = useCallback((cardName) => {
        setStatus(`Found: ${cardName}`);
        lastScanTime.current = Date.now() / 1000;
        onCardScanned(cardName);
    }, [onCardScanned]);

    // 3. Scanning Loop
    useEffect(() => {
        let interval;
        if (isScanning && fuse) {
            interval = setInterval(async () => {
                const now = Date.now() / 1000;
                if (now - lastScanTime.current < SCAN_COOLDOWN) return;

                if (videoRef.current && canvasRef.current) {
                    const video = videoRef.current;
                    const canvas = canvasRef.current;
                    const ctx = canvas.getContext('2d');

                    if (video.videoWidth === 0 || video.videoHeight === 0) return;

                    // Define Region of Interest (The green box area)
                    const roiX = video.videoWidth * 0.2;
                    const roiY = video.videoHeight * 0.08; 
                    const roiW = video.videoWidth * 0.6;
                    const roiH = video.videoHeight * 0.15;

                    canvas.width = roiW;
                    canvas.height = roiH;
                    ctx.drawImage(video, roiX, roiY, roiW, roiH, 0, 0, roiW, roiH);

                    const { data: { text } } = await Tesseract.recognize(canvas, 'eng');
                    const cleaned = text.replace(/[^a-zA-Z\s]/g, '').trim();

                    if (cleaned.length > 3) {
                        const results = fuse.search(cleaned);
                        // Using the constant MATCH_THRESHOLD now
                        if (results.length > 0 && results[0].score < MATCH_THRESHOLD) { 
                            const match = results[0].item;
                            recentReads.current.push(match);
                            
                            // Check for consecutive matches
                            if (recentReads.current.length >= REQUIRED_CONSECUTIVE_MATCHES) {
                                const allSame = recentReads.current.every(val => val === match);
                                if (allSame) {
                                    handleScanSuccess(match);
                                }
                                recentReads.current.shift(); // Keep buffer small
                            }
                        }
                    }
                }
            }, 600); // Scan interval
        }
        return () => clearInterval(interval);
    }, [isScanning, fuse, handleScanSuccess]); // handleScanSuccess is now a dependency

    const switchCamera = () => {
        if (cameras.length > 1) {
            const currentIndex = cameras.findIndex(c => c.deviceId === activeCameraId);
            const nextIndex = (currentIndex + 1) % cameras.length;
            const nextId = cameras[nextIndex].deviceId;
            setActiveCameraId(nextId);
            startCamera(nextId);
        }
    };

    return (
        <div className="flex flex-col items-center w-full h-full bg-black rounded-xl overflow-hidden relative">
            {/* Camera View */}
            <div className="relative w-full aspect-video bg-gray-900">
                <video 
                    ref={videoRef} 
                    className="w-full h-full object-cover" 
                    playsInline 
                    muted 
                />
                
                {/* Overlay UI */}
                <div className="absolute inset-0 pointer-events-none flex flex-col items-center">
                    {/* Top Status Bar */}
                    <div className="w-full p-2 bg-black/50 text-white text-center text-sm font-mono backdrop-blur-sm">
                        {status}
                    </div>

                    {/* Guidelines - The Green Box */}
                    <div className="mt-8 w-[80%] h-[15%] border-2 border-green-400 rounded-lg shadow-[0_0_20px_rgba(74,222,128,0.5)] relative">
                        <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-green-400 text-xs font-bold bg-black/70 px-2 rounded">
                            CARD TITLE HERE
                        </div>
                    </div>

                    {/* Instructions */}
                    <div className="mt-auto mb-4 bg-black/60 px-4 py-2 rounded-full text-white/80 text-xs">
                        Hold steady. Good lighting is key.
                    </div>
                </div>
            </div>

            {/* Controls */}
            <div className="flex gap-4 mt-4 mb-2">
                {cameras.length > 1 && (
                    <button onClick={switchCamera} className="p-3 bg-gray-700 rounded-full text-white hover:bg-gray-600 transition-colors">
                        <RefreshCw size={24} />
                    </button>
                )}
            </div>

            {/* Hidden Canvas for Processing */}
            <canvas ref={canvasRef} className="hidden" />
        </div>
    );
};

export default CardScanner;
