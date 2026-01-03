import cv2
import pytesseract
import requests
import re
import time
import threading
from collections import deque
from thefuzz import process
import textwrap

#pytesseract.pytesseract.tesseract_cmd = r'c:\Users\Brendon\AppData\Local\Programs\Tesseract-OCR\tesseract.exe'

def get_all_card_names():
    """Downloads a set of all unique card names from Scryfall for fast validation."""
    print("Downloading all card names for validation...")
    try:
        response = requests.get("https://api.scryfall.com/catalog/card-names")
        if response.status_code == 200:
            card_names = response.json()['data']
            print(f"Loaded {len(card_names)} unique card names.")
            # Use a lowercase set for all comparisons
            return set(name.title() for name in card_names)
        else: return None
    except requests.exceptions.RequestException: return None

def fetch_and_display_card_data(card_name, state):
    """This function runs in a separate thread to avoid freezing the camera."""
    print(f"Thread started: Searching for '{card_name}'...")
    # Use lowercase for the search query to match our validation set
    url = f"https://api.scryfall.com/cards/named?exact={card_name.replace(' ', '+')}"
    try:
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            card_data = response.json()
            state['last_card_data'] = card_data
            # Store the official name, but we will use lowercase for comparison
            state['last_scanned_name'] = card_data.get('name', '')
    except requests.exceptions.RequestException as e: print(f"API request failed: {e}")
    state['last_scan_time'] = time.time()
    print("Thread finished.")


def main():
    VALID_CARD_NAMES = get_all_card_names()
    if VALID_CARD_NAMES is None: return

    cap = cv2.VideoCapture(2)
    if not cap.isOpened(): print("Error: Could not open camera."); return
        
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280); cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    roi = (300, 50, 360, 50)

    REQUIRED_CONSECUTIVE_MATCHES = 3
    MATCH_CONFIDENCE_THRESHOLD = 85
    
    app_state = {
        'last_scan_time': 0,
        'last_scanned_name': "",
        'last_card_data': None,
        'recent_reads': deque(maxlen=REQUIRED_CONSECUTIVE_MATCHES)
    }
    scan_cooldown = 5

    print("Scanner active. Hold card steady for validation. Press 'q' to quit.")

    while True:
        ret, frame = cap.read()
        if not ret: break
        
        is_on_cooldown = (time.time() - app_state['last_scan_time']) < scan_cooldown
        if not is_on_cooldown:
            gray_roi = cv2.cvtColor(frame[roi[1]:roi[1]+roi[3], roi[0]:roi[0]+roi[2]], cv2.COLOR_BGR2GRAY)
            ocr_text = pytesseract.image_to_string(gray_roi).strip()
            # Use lowercase for OCR text to match validation set
            cleaned_text = re.sub(r"[^a-zA-Z\s,']", "", ocr_text).title()

            if 2 < len(cleaned_text) < 30:
                best_match, confidence = process.extractOne(cleaned_text, VALID_CARD_NAMES)
                if confidence >= MATCH_CONFIDENCE_THRESHOLD:
                    app_state['recent_reads'].append(best_match)

            BASIC_LAND_NAMES = {'Plains', 'Island', 'Swamp', 'Mountain', 'Forest'}

            if len(app_state['recent_reads']) == REQUIRED_CONSECUTIVE_MATCHES and len(set(app_state['recent_reads'])) == 1:
                confident_read = app_state['recent_reads'][0]
                
                # --- BUG FIX: Compare lowercase to lowercase ---
                if confident_read != app_state['last_scanned_name'].title():
                    if confident_read in BASIC_LAND_NAMES:
                        print(f"Locally handling basic land: {confident_read.title()}")
                        # Manually create a simple data object for the land
                        app_state['last_card_data'] = {
                            'name': confident_read.title(),
                            'type_line': f'Basic Land — {confident_read.title()}'
                        }
                        app_state['last_scanned_name'] = confident_read.title()
                        app_state['last_scan_time'] = time.time() # Start cooldown
                    
                    # --- Existing logic for all other cards ---
                    else:
                        scan_thread = threading.Thread(target=fetch_and_display_card_data, args=(confident_read, app_state))
                        scan_thread.start()
                        app_state['last_scan_time'] = time.time()
                        app_state['recent_reads'].clear()

        box_color = (0, 0, 255) if is_on_cooldown else (0, 255, 0)
        cv2.rectangle(frame, (roi[0], roi[1]), (roi[0] + roi[2], roi[1] + roi[3]), box_color, 2)
        
        if app_state['last_card_data']:
            card = app_state['last_card_data']
            
            # --- CRASH FIX: Initialize drawing variables here ---
            # These are now available for both basic lands and other cards.
            y_pos, font_scale, font_color, font = 40, 0.6, (255, 255, 255), cv2.FONT_HERSHEY_SIMPLEX
            
            if 'Basic Land' in card.get('type_line', ''):
                land_name = card.get('name', 'N/A')
                cv2.putText(frame, land_name, (10, 80), font, 1.5, font_color, 3)
            # --- Existing display logic for all other cards ---
            else:
                # Create a semi-transparent overlay for the text panel
                overlay = frame.copy()
                cv2.rectangle(overlay, (0, 0), (300, frame.shape[0]), (0, 0, 0), -1)
                frame = cv2.addWeighted(overlay, 0.6, frame, 0.4, 0)

                # Draw text on top of the panel
                y_pos, font_scale, font_color, font = 40, 0.6, (255, 255, 255), cv2.FONT_HERSHEY_SIMPLEX

                # Draw card name and mana cost
                card_name = card.get('name', 'N/A')
                cv2.putText(frame, card_name, (10, y_pos), font, 0.7, font_color, 2); y_pos += 25 
                mana_cost = card.get('mana_cost', '')
                cv2.putText(frame, mana_cost, (10, y_pos), font, 0.7, font_color, 2); y_pos += 35 
                
                # Draw type line and rarity
                type_line = card.get('type_line', 'N/A').replace('—', '-')
                cv2.putText(frame, type_line, (10, y_pos), font, font_scale, font_color, 1); y_pos += 20
                rarity = card.get('rarity', '').title()
                cv2.putText(frame, rarity, (10, y_pos), font, font_scale, font_color, 1); y_pos += 25

                # --- Display Keywords and clean them from Oracle Text ---
                keywords_list = card.get('keywords', [])
                if keywords_list:
                    unique_keywords = ", ".join(list(set(keywords_list))).title()
                    cv2.putText(frame, unique_keywords, (10, y_pos), font, font_scale, font_color, 1)
                    y_pos += 25
                
                oracle_text = card.get('oracle_text', '')
                if oracle_text:
                    # Replace special characters first
                    oracle_text = oracle_text.replace('−', '-').replace('—', '-').replace('–', '-')

                    # --- ADDED: Re-integrate the keyword filter ---
                    lower_keywords_set = {kw.lower() for kw in keywords_list}
                    original_lines = oracle_text.split('\n')

                    for line in original_lines:
                        # Check if the current line is a keyword-only line
                        line_words = line.lower().replace(',', '').strip().split()
                        is_keyword_only_line = line_words and all(word in lower_keywords_set for word in line_words)

                        # If it is NOT a keyword line, display it
                        if not is_keyword_only_line:
                            wrapped_lines = textwrap.wrap(line, width=55)
                            if not wrapped_lines:
                                y_pos += 10 # Add space for empty lines
                            else:
                                for wrapped_line in wrapped_lines:
                                    cv2.putText(frame, wrapped_line, (10, y_pos), font, font_scale, font_color, 1)
                                    y_pos += 20
                
                # Display Power/Toughness if it exists
                if 'power' in card:
                    pt_text = f"{card.get('power')}/{card.get('toughness')}"
                    cv2.putText(frame, pt_text, (10, y_pos + 10), font, 0.7, font_color, 2)
                elif 'loyalty' in card:
                    loyalty_text = f"Loyalty: {card.get('loyalty')}"
                    cv2.putText(frame, loyalty_text, (10, y_pos + 10), font, 0.7, font_color, 2)

        cv2.imshow('Card Scanner with Info Panel', frame)
        if cv2.waitKey(1) & 0xFF == ord('q'): break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()