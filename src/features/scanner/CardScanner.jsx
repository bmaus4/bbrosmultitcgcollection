import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Video } from 'lucide-react';
import Tesseract from 'tesseract.js';
import Fuse from 'fuse.js';

// Relaxed constraints for better mobile hit rate
const REQUIRED_CONSECUTIVE_MATCHES = 2; 
const MATCH_THRESHOLD = 0.4; // 0.0 is exact match, 0.4 allows for some OCR errors
const SCAN_COOLDOWN = 3; 

const CardScanner = ({ onCardScanned, showMessage }) => {
    const [isScanning, setIsScanning] = useState(false);
    const [status, setStatus] = useState('Initializing...');
    const [debugText, setDebugText] = useState(''); // Visual feedback of what it sees
    const [allCardNames, setAllCardNames] = useState([]);
    const [fuse, setFuse] = useState(null);
    const [cameras, setCameras] = useState([]);
    const [activeCameraId, setActiveCameraId] = useState(null);
    
    const recentReads = useRef([]);
    const lastScanTime = useRef(0);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);

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

    const startCamera = useCallback(async (deviceId = null) => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }

        try {
            const constraints = {
                video: {
                    deviceId: deviceId ? { exact: deviceId } : undefined,
                    facingMode: deviceId ? undefined : 'environment',
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
                    setStatus('Align title in box');
                };
            }

            const devices = await navigator.mediaDevices.enumerateDevices();
            setCameras(devices.filter(d => d.kind === 'videoinput'));

        } catch (err) {
            console.error("Camera Error:", err);
            showMessage("Camera access denied.", "error");
        }
    }, [showMessage]);

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

    const handleScanSuccess = useCallback((cardName) => {
        setStatus(`SUCCESS: ${cardName}`);
        lastScanTime.current = Date.now() / 1000;
        onCardScanned(cardName);
        // Clear buffer to prevent double scans
        recentReads.current = [];
    }, [onCardScanned]);

    // Image Pre-processing Helper
    const preprocessImage = (ctx, width, height) => {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        // Simple binarization (high contrast black & white)
        for (let i = 0; i < data.length; i += 4) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            const val = avg > 100 ? 255 : 0; // Threshold
            data[i] = val; // R
            data[i + 1] = val; // G
            data[i + 2] = val; // B
        }
        ctx.putImageData(imageData, 0, 0);
    };

    useEffect(() => {
        let interval;
        if (isScanning && fuse) {
            interval = setInterval(async () => {
                const now = Date.now() / 1000;
                if (now - lastScanTime.current < SCAN_COOLDOWN) {
                    setStatus("Cooldown...");
                    return;
                }

                if (videoRef.current && canvasRef.current) {
                    const video = videoRef.current;
                    const canvas = canvasRef.current;
                    const ctx = canvas.getContext('2d');

                    if (video.videoWidth === 0) return;

                    // Scan the top 20% of the video where the title usually is
                    const roiX = video.videoWidth * 0.15;
                    const roiY = video.videoHeight * 0.15; 
                    const roiW = video.videoWidth * 0.7;
                    const roiH = video.videoHeight * 0.20;

                    canvas.width = roiW;
                    canvas.height = roiH;
                    ctx.drawImage(video, roiX, roiY, roiW, roiH, 0, 0, roiW, roiH);
                    
                    // Apply contrast filter to help OCR
                    preprocessImage(ctx, roiW, roiH);

                    const { data: { text } } = await Tesseract.recognize(canvas, 'eng');
                    // Clean text: keep only letters and spaces
                    const cleaned = text.replace(/[^a-zA-Z\s]/g, '').trim();
                    
                    if (cleaned.length > 3) {
                        setDebugText(cleaned.substring(0, 20)); // Show user what we see
                        const results = fuse.search(cleaned);
                        
                        if (results.length > 0 && results[0].score < MATCH_THRESHOLD) { 
                            const match = results[0].item;
                            recentReads.current.push(match);
                            
                            if (recentReads.current.length >= REQUIRED_CONSECUTIVE_MATCHES) {
                                // Check if recent reads mostly agree
                                const counts = {};
                                let maxCount = 0;
                                let bestGuess = null;
                                
                                recentReads.current.forEach(val => {
                                    counts[val] = (counts[val] || 0) + 1;
                                    if (counts[val] > maxCount) {
                                        maxCount = counts[val];
                                        bestGuess = val;
                                    }
                                });

                                if (maxCount >= REQUIRED_CONSECUTIVE_MATCHES) {
                                    handleScanSuccess(bestGuess);
                                }
                                // Keep buffer small
                                if(recentReads.current.length > 5) recentReads.current.shift();
                            }
                        }
                    }
                }
            }, 500); // Check twice a second
        }
        return () => clearInterval(interval);
    }, [isScanning, fuse, handleScanSuccess]);

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
            <div className="relative w-full aspect-video bg-gray-900">
                <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                
                <div className="absolute inset-0 pointer-events-none flex flex-col items-center">
                    <div className="w-full p-2 bg-black/70 text-white text-center text-sm font-mono backdrop-blur-md border-b border-gray-700">
                        {status}
                    </div>

                    {/* Guidelines */}
                    <div className={`mt-12 w-[70%] h-[20%] border-4 rounded-lg shadow-[0_0_30px_rgba(0,0,0,0.5)] relative transition-colors ${status.includes('SUCCESS') ? 'border-green-400 bg-green-500/20' : 'border-white/40'}`}>
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-white/90 text-xs font-bold bg-black/60 px-3 py-1 rounded-full uppercase tracking-wider">
                            Card Title
                        </div>
                    </div>

                    <div className="mt-auto mb-4 bg-black/60 px-4 py-2 rounded-full text-gray-300 text-xs font-mono">
                         Saw: <span className="text-white font-bold">{debugText || "..."}</span>
                    </div>
                </div>
            </div>

            <div className="flex gap-4 mt-4 mb-2">
                {cameras.length > 1 && (
                    <button onClick={switchCamera} className="p-3 bg-gray-700 rounded-full text-white hover:bg-gray-600 transition-colors">
                        <RefreshCw size={24} />
                    </button>
                )}
            </div>
            
            <canvas ref={canvasRef} className="hidden" />
        </div>
    );
};

export default CardScanner;
