import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import Tesseract from 'tesseract.js';
import Fuse from 'fuse.js';

// RELAXED CONSTRAINTS FOR BETTER HIT RATE
const REQUIRED_CONSECUTIVE_MATCHES = 1; // Instant feedback
const MATCH_THRESHOLD = 0.3; // Looser matching (0.0 is perfect, 1.0 is awful)
const SCAN_COOLDOWN = 2; 

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

    // 1. Load Card Catalog
    useEffect(() => {
        const fetchCardNames = async () => {
            try {
                const response = await fetch("https://api.scryfall.com/catalog/card-names");
                const data = await response.json();
                setAllCardNames(data.data);
                // Initialize Fuse with threshold matching the constant
                setFuse(new Fuse(data.data, { threshold: 0.4 })); 
                setStatus('Ready to Scan');
            } catch (error) {
                console.error(error);
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
                    setStatus('Align title in box');
                };
            }

            // Get list of cameras for the switcher button
            const devices = await navigator.mediaDevices.enumerateDevices();
            setCameras(devices.filter(d => d.kind === 'videoinput'));

        } catch (err) {
            console.error("Camera Error:", err);
            showMessage("Camera access denied. Please check permissions.", "error");
        }
    }, [showMessage]);

    // Handle initial camera start once catalog is loaded
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

    // Success Handler
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

    // 3. Scanning Loop
    useEffect(() => {
        let interval;
        if (isScanning && fuse) {
            interval = setInterval(async () => {
                const now = Date.now() / 1000;
                // Check Cooldown
                if (now - lastScanTime.current < SCAN_COOLDOWN) {
                    setStatus("Cooldown...");
                    return;
                }

                if (videoRef.current && canvasRef.current) {
                    const video = videoRef.current;
                    const canvas = canvasRef.current;
                    const ctx = canvas.getContext('2d');

                    if (video.videoWidth === 0 || video.videoHeight === 0) return;

                    // Define Region of Interest (The green box area)
                    // We scan the top-center portion where card titles usually are
                    const roiX = video.videoWidth * 0.15;
                    const roiY = video.videoHeight * 0.15; 
                    const roiW = video.videoWidth * 0.7;
                    const roiH = video.videoHeight * 0.20;

                    canvas.width = roiW;
                    canvas.height = roiH;
                    ctx.drawImage(video, roiX, roiY, roiW, roiH, 0, 0, roiW, roiH);
                    
                    // Apply contrast filter to help OCR
                    preprocessImage(ctx, roiW, roiH);

                    // Perform OCR
                    const { data: { text } } = await Tesseract.recognize(canvas, 'eng');
                    // Clean text: keep only letters and spaces
                    const cleaned = text.replace(/[^a-zA-Z\s]/g, '').trim();
                    
                    if (cleaned.length > 3) {
                        setDebugText(cleaned.substring(0, 20)); // Show user what we see
                        const results = fuse.search(cleaned);
                        
                        // Check if we found a match within our threshold
                        if (results.length > 0 && results[0].score < MATCH_THRESHOLD) { 
                            const match = results[0].item;
                            recentReads.current.push(match);
                            
                            // Check for consecutive matches (validation)
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

    // Camera Switcher
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
                    <div className="w-full p-2 bg-black/50 text-white text-center text-sm font-mono backdrop-blur-sm transition-all">
                        {status}
                    </div>

                    {/* Guidelines - The Green Box */}
                    <div className={`mt-12 w-[70%] h-[20%] border-4 rounded-lg shadow-[0_0_30px_rgba(0,0,0,0.5)] relative transition-colors ${status.includes('SUCCESS') ? 'border-green-400 bg-green-500/20' : 'border-white/40'}`}>
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-white/90 text-xs font-bold bg-black/60 px-3 py-1 rounded-full uppercase tracking-wider">
                            Card Title
                        </div>
                    </div>

                    {/* Debug Text - What the Scanner Sees */}
                    <div className="mt-auto mb-4 bg-black/60 px-4 py-2 rounded-full text-gray-300 text-xs font-mono">
                         Saw: <span className="text-white font-bold">{debugText || "..."}</span>
                    </div>
                </div>
            </div>

            {/* Controls */}
            <div className="flex gap-4 mt-4 mb-2">
                {cameras.length > 1 && (
                    <button onClick={switchCamera} className="p-3 bg-gray-700 rounded-full text-white hover:bg-gray-600 transition-colors" title="Switch Camera">
                        <RefreshCw size={24} />
                    </button>
                )}
            </div>

            {/* Hidden Canvas for Processing */}
            <canvas ref={canvasRef} className="hidden" />
            
            {/* Loading Indicator */}
            {allCardNames.length === 0 && (
                <div className="absolute inset-0 bg-black/80 flex items-center justify-center text-yellow-400 font-mono z-50">
                    Loading card catalog...
                </div>
            )}
        </div>
    );
};

export default CardScanner;
