import difflib

# Keywords for each of the standard fields
KEYWORDS = {
    'vendor': ['vendor', 'vendor_name', 'supplier', 'ownership', 'filter_ownership', 'hext_filter_ownership', 'client', 'customer'],
    'accuracy': ['accuracy', 'accuracy_percentage', 'hext_accuracy_percentage', 'score', 'rate', 'overall_accuracy'],
    'document_id': ['document_id', 'file_id', 'record_id', 'ref_id', 'referenceid', 'unique_id', 'key_id', 'hext_key_id', 'ocr_document_id'],
    'relationship_key_parent': ['key_id', 'hext_key_id', 'document_id', 'id'],
    'relationship_key_child': ['key_id', 'dcmp_key_id', 'parent_id', 'id'],
    'column_name': ['column_name', 'field_name', 'column', 'attribute', 'field', 'dcmp_column_name'],
    'matching_percentage': ['matching_percent', 'matching_percentage', 'match_percent', 'match_percentage', 'field_accuracy', 'col_accuracy', 'dcmp_matching_percent'],
    'start_time': ['start_time', 'processing_start_time', 'hext_processing_start_time', 'start', 'created', 'created_at', 'timestamp', 'time'],
    'end_time': ['end_time', 'processing_end_time', 'hext_processing_end_time', 'end', 'completed', 'completed_at', 'finished', 'finished_at']
}

def clean_name(name):
    if not isinstance(name, str):
        return ""
    return name.strip().lower().replace('_', ' ').replace('-', ' ')

def get_similarity(col_name, target_field):
    normalized_col = clean_name(col_name)
    best_score = 0.0
    
    for kw in KEYWORDS[target_field]:
        normalized_kw = clean_name(kw)
        if normalized_col == normalized_kw:
            return 1.0
        
        # Substring matching
        if normalized_kw in normalized_col or normalized_col in normalized_kw:
            sub_score = min(len(normalized_kw), len(normalized_col)) / max(len(normalized_kw), len(normalized_col))
            if normalized_col.startswith(normalized_kw):
                sub_score = min(1.0, sub_score + 0.1)
            best_score = max(best_score, sub_score * 0.9)
            
        # Sequence matching
        ratio = difflib.SequenceMatcher(None, normalized_col, normalized_kw).ratio()
        best_score = max(best_score, ratio)
        
    return best_score

def detect_mappings(dfs):
    """
    Given a dictionary of DataFrames, automatically detects mappings for standard fields.
    Returns:
      {
        "vendor": {"sheet": "...", "column": "..."},
        "accuracy": {"sheet": "...", "column": "..."},
        ...
      }
    """
    mappings = {
        'vendor': None,
        'accuracy': None,
        'document_id': None,
        'relationship_key_parent': None,
        'relationship_key_child': None,
        'column_name': None,
        'matching_percentage': None,
        'start_time': None,
        'end_time': None
    }
    
    # Store all candidates with scores
    candidates = {k: [] for k in mappings.keys()}
    
    for sheet_name, df in dfs.items():
        columns = df.columns.tolist()
        for col in columns:
            for field in mappings.keys():
                score = get_similarity(col, field)
                if score > 0.4:  # Threshold
                    candidates[field].append({
                        'sheet': sheet_name,
                        'column': col,
                        'score': score
                    })
                    
    # Resolve best candidates. Sort by score descending.
    for field in mappings.keys():
        field_candidates = sorted(candidates[field], key=lambda x: x['score'], reverse=True)
        if field_candidates:
            mappings[field] = {
                'sheet': field_candidates[0]['sheet'],
                'column': field_candidates[0]['column']
            }
            
    # Post-processing heuristics:
    parent_sheet = mappings['accuracy']['sheet'] if mappings['accuracy'] else None
    
    # Let's ensure relationship_key_parent is on the parent sheet
    if parent_sheet and not mappings['relationship_key_parent']:
        for col in dfs[parent_sheet].columns:
            score = get_similarity(col, 'relationship_key_parent')
            if score > 0.3:
                mappings['relationship_key_parent'] = {'sheet': parent_sheet, 'column': col}
                break

    # Let's ensure relationship_key_child is on a different sheet (if multiple sheets exist)
    if len(dfs) > 1 and parent_sheet:
        child_sheets = [s for s in dfs.keys() if s != parent_sheet]
        if child_sheets:
            c_sheet = child_sheets[0]
            if not mappings['relationship_key_child']:
                for col in dfs[c_sheet].columns:
                    score = get_similarity(col, 'relationship_key_child')
                    if score > 0.3:
                        mappings['relationship_key_child'] = {'sheet': c_sheet, 'column': col}
                        break
                        
            # Ensure column_name and matching_percentage are mapped to the child sheet
            for field in ['column_name', 'matching_percentage']:
                if not mappings[field] or mappings[field]['sheet'] == parent_sheet:
                    best_col = None
                    best_score = 0.0
                    for col in dfs[c_sheet].columns:
                        score = get_similarity(col, field)
                        if score > best_score:
                            best_score = score
                            best_col = col
                    if best_col and best_score > 0.3:
                        mappings[field] = {'sheet': c_sheet, 'column': best_col}

    return mappings
