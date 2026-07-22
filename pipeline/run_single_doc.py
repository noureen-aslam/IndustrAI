from extract_entities import extract_entities_single_doc

# Edit these, then run: python run_single_doc.py
DOC_ID = "manuals_centrifugal_pump_o_m_manual_generic_0b5c6199"
MAX_CHUNKS = 10 # keeps this well under your daily Gemini quota

if __name__ == "__main__":
    extract_entities_single_doc(DOC_ID, limit=MAX_CHUNKS)