import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import Tesseract from 'tesseract.js';
import Fuse from 'fuse.js';

// Optimizations for speed and "Best Guess" logic
const SCAN_WINDOW_MS = 3000; // Look for 3 seconds before deciding
const MATCH_THRESHOLD = 0.4; // 0.0 is perfect, 0.4 allows partial/ocr errors
const SCAN_COOLDOWN = 1.5; // Faster turnaround between cards

const CardScanner = ({ onCardScanned, showMessage }) => {
    const [isScanning, setIsScanning] = useState(false);
    const [status, setStatus] = useState('Initializing...');
    const [debugText, setDebugText] = useState(''); 
    const [allCardNames, setAllCardNames] = useState([]);
    const [fuse, setFuse] = useState(null);
    const [cameras, setCameras] = useState([]);
    const [activeCameraId, setActiveCameraId] = useState(null);
    
    // Accumulate reads over time window
    const accumulatedReads = useRef([]);
    const scanWindowStart = useRef(0);
    const lastSuccessTime = useRef(0);

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
                // Lower threshold = stricter, Higher = fuzzier. 0.4 is a good balance.
                setFuse(new Fuse(data.data, { threshold: 0.4, minMatchCharLength: 4 })); 
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
                    scanWindowStart.current = Date.now(); // Start the timer
                };
            }

            const devices = await navigator.mediaDevices.enumerateDevices();
            setCameras(devices.filter(d => d.kind === 'videoinput'));

        } catch (err) {
            console.error("Camera Error:", err);
            showMessage("Camera access denied. Please check permissions.", "error");
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

    // Finalize the best guess from the window
    const processBestGuess = useCallback(() => {
        const reads = accumulatedReads.current;
        if (reads.length === 0) {
            // Reset window if nothing found
            scanWindowStart.current = Date.now();
            return;
        }

        // Count occurrences of each card name
        const counts = {};
        reads.forEach(name => {
            counts[name] = (counts[name] || 0) + 1;
        });

        // Find the card with the highest count
        let bestGuess = null;
        let maxCount = 0;
        Object.entries(counts).forEach(([name, count]) => {
            if (count > maxCount) {
                maxCount = count;
                bestGuess = name;
            }
        });

        // Threshold: Must have seen it at least twice in the window to confirm
        if (bestGuess && maxCount >= 2) {
            setStatus(`ADDED: ${bestGuess}`);
            onCardScanned(bestGuess);
            lastSuccessTime.current = Date.now();
            accumulatedReads.current = []; // Clear buffer
        } 
        
        // Reset window for next card
        scanWindowStart.current = Date.now();
        accumulatedReads.current = [];
        
    }, [onCardScanned]);


    // Image Pre-processing Helper
    const preprocessImage = (ctx, width, height) => {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            const val = avg > 100 ? 255 : 0; // High contrast threshold
            data[i] = val; 
            data[i + 1] = val; 
            data[i + 2] = val; 
        }
        ctx.putImageData(imageData, 0, 0);
    };

    // 3. Scanning Loop
    useEffect(() => {
        let interval;
        if (isScanning && fuse) {
            interval = setInterval(async () => {
                const now = Date.now();
                
                // Cooldown check
                if ((now - lastSuccessTime.current) / 1000 < SCAN_COOLDOWN) {
                    setStatus("Cooldown...");
                    return;
                }

                // Check if scan window time is up
                if (now - scanWindowStart.current > SCAN_WINDOW_MS) {
                    processBestGuess();
                    return;
                }

                if (videoRef.current && canvasRef.current) {
                    const video = videoRef.current;
                    const canvas = canvasRef.current;
                    const ctx = canvas.getContext('2d');

                    if (video.videoWidth === 0) return;

                    // Scan Region: Top 20%
                    const roiX = video.videoWidth * 0.15;
                    const roiY = video.videoHeight * 0.15; 
                    const roiW = video.videoWidth * 0.7;
                    const roiH = video.videoHeight * 0.20;

                    canvas.width = roiW;
                    canvas.height = roiH;
                    ctx.drawImage(video, roiX, roiY, roiW, roiH, 0, 0, roiW, roiH);
                    
                    preprocessImage(ctx, roiW, roiH);

                    const { data: { text } } = await Tesseract.recognize(canvas, 'eng');
                    const cleaned = text.replace(/[^a-zA-Z\s]/g, '').trim();

                    if (cleaned.length > 3) {
                        setDebugText(cleaned); 
                        const results = fuse.search(cleaned);
                        
                        if (results.length > 0 && results[0].score < MATCH_THRESHOLD) { 
                            const match = results[0].item;
                            // Add match to buffer
                            accumulatedReads.current.push(match);
                            setStatus(`Identifying: ${match}...`);
                        }
                    }
                }
            }, 400); // Check faster (400ms) to gather more data points
        }
        return () => clearInterval(interval);
    }, [isScanning, fuse, processBestGuess]);

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
                    <div className={`w-full p-2 text-white text-center text-sm font-mono backdrop-blur-md border-b border-gray-700 transition-colors ${status.includes('ADDED') ? 'bg-green-600' : 'bg-black/70'}`}>
                        {status}
                    </div>

                    <div className={`mt-12 w-[70%] h-[20%] border-4 rounded-lg shadow-[0_0_30px_rgba(0,0,0,0.5)] relative transition-colors border-white/40`}>
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-white/90 text-xs font-bold bg-black/60 px-3 py-1 rounded-full uppercase tracking-wider">
                            Card Title
                        </div>
                    </div>

                    <div className="mt-auto mb-4 bg-black/60 px-4 py-2 rounded-full text-gray-300 text-xs font-mono">
                         Raw: <span className="text-white font-bold">{debugText || "..."}</span>
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
            
            {allCardNames.length === 0 && (
                <div className="absolute inset-0 bg-black/80 flex items-center justify-center text-yellow-400 font-mono z-50">
                    Loading card catalog...
                </div>
            )}
        </div>
    );
};

export default CardScanner;
