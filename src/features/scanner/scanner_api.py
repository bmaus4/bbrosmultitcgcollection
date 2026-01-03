import cv2
import pytesseract
import requests
import re
import time
from collections import deque
from thefuzz import process
from flask import Flask, jsonify
from flask_cors import CORS

# --- IMPORTANT: CONFIGURE TESSERACT PATH ---
# pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

app = Flask(__name__)
CORS(app) # Allows your React app to talk to this server

# Global state to hold scanner results
scan_result = {"card_name": None}

def scanner_logic():
    """Contains the main computer vision and OCR logic."""
    global scan_result
    scan_result = {"card_name": None} # Reset result

    VALID_CARD_NAMES = set()
    try:
        response = requests.get("https://api.scryfall.com/catalog/card-names")
        if response.status_code == 200:
            VALID_CARD_NAMES = set(name.title() for name in response.json()['data'])
            print(f"Loaded {len(VALID_CARD_NAMES)} unique card names.")
    except Exception as e:
        print(f"Could not load card names: {e}")
        return

    cap = cv2.VideoCapture(0) # Use camera index 0, or change if needed
    if not cap.isOpened():
        print("Error: Could not open camera.")
        return
        
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    roi = (300, 50, 360, 50)
    recent_reads = deque(maxlen=3)

    print("Scanner window active. Hold card steady. Window will close on successful scan.")

    start_time = time.time()
    while time.time() - start_time < 30: # Timeout after 30 seconds
        ret, frame = cap.read()
        if not ret: break

        gray_roi = cv2.cvtColor(frame[roi[1]:roi[1]+roi[3], roi[0]:roi[0]+roi[2]], cv2.COLOR_BGR2GRAY)
        ocr_text = pytesseract.image_to_string(gray_roi).strip()
        cleaned_text = re.sub(r"[^a-zA-Z\s,']", "", ocr_text).title()

        if 2 < len(cleaned_text) < 30:
            best_match, confidence = process.extractOne(cleaned_text, VALID_CARD_NAMES)
            if confidence >= 85:
                recent_reads.append(best_match)

        if len(recent_reads) == 3 and len(set(recent_reads)) == 1:
            confident_read = recent_reads[0]
            print(f"Scan successful: {confident_read}")
            scan_result['card_name'] = confident_read
            break # Exit loop on success

        cv2.rectangle(frame, (roi[0], roi[1]), (roi[0] + roi[2], roi[1] + roi[3]), (0, 255, 0), 2)
        cv2.imshow('Python Scanner', frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

@app.route('/scan', methods=['GET'])
def scan_card():
    """API endpoint that triggers the scanner."""
    scanner_logic()
    return jsonify(scan_result)

if __name__ == "__main__":
    print("Starting Python scanner server at http://localhost:5000")
    app.run(port=5000)
