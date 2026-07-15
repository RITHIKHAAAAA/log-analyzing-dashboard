import pandas as pd
import numpy as np

INVALID_REPRESENTATIONS = {'???', '----', 'n/a', 'unknown', 'invalid', 'null', 'nan', ''}

def is_invalid(val):
    if val is None:
        return True
    try:
        if pd.isna(val):
            return True
    except (TypeError, ValueError):
        # pd.isna() can raise on non-scalar types (list, dict, etc.)
        return False
    s = str(val).strip().lower()
    if s in INVALID_REPRESENTATIONS:
        return True
    return False


def is_valid_vendor_name(name):
    """
    Returns True only if the vendor name looks like a real, human-readable string.
    Rejects:
      - Names containing '?' characters
      - Names where more than 30% of characters are non-ASCII / replacement chars
      - Names that are only whitespace, digits, punctuation, or symbols
      - Names shorter than 2 meaningful characters after stripping
    """
    if not name or not isinstance(name, str):
        return False

    s = name.strip()
    if not s or len(s) < 2:
        return False

    # Reject any name containing a literal '?' (garbled / unknown encoding)
    if '?' in s:
        return False

    # Reject Unicode replacement character U+FFFD
    if '\ufffd' in s:
        return False

    # Count non-ASCII characters
    non_ascii = sum(1 for c in s if ord(c) > 127)
    # Allow up to 40% non-ASCII (handles legitimate names in other scripts)
    # but reject if the majority are non-ASCII replacement-like characters
    if len(s) > 0 and (non_ascii / len(s)) > 0.7:
        return False

    # Reject names that are entirely digits, punctuation, or dashes
    alpha_count = sum(1 for c in s if c.isalpha())
    if alpha_count == 0:
        return False

    return True


def clean_percentage_series(series):
    """
    Cleans a pandas Series representing percentages.
    Converts strings with '%' to float, parses numbers, scales if [0, 1] range, and clamps to [0, 100].
    """
    def parse_pct(val):
        if pd.isna(val) or val is None:
            return np.nan
        s = str(val).strip()
        if not s or s.lower() in INVALID_REPRESENTATIONS:
            return np.nan
        if s.endswith('%'):
            s = s[:-1].strip()
        try:
            return float(s)
        except ValueError:
            return np.nan

    cleaned = series.apply(parse_pct)
    
    # Scale decimal fraction columns in [0, 1] range to [0, 100]
    non_nan = cleaned.dropna()
    if not non_nan.empty and non_nan.max() <= 1.0:
        # Check if there are any values greater than 0
        cleaned = cleaned * 100.0

    # Clamp percentages between 0 and 100
    cleaned = cleaned.clip(0.0, 100.0)
    return cleaned

def clean_and_join_data(dfs, mappings):
    """
    Cleans DataFrames and joins parent/child sheets.
    Returns:
      cleaned_parent: DataFrame
      cleaned_child: DataFrame
      joined_df: DataFrame (or None if no join possible)
    """
    parent_map = mappings.get('accuracy')
    child_map = mappings.get('matching_percentage')
    
    parent_sheet = parent_map['sheet'] if parent_map else None
    child_sheet = child_map['sheet'] if child_map else None
    
    df_parent = None
    df_child = None
    
    # Clean Parent Sheet
    if parent_sheet and parent_sheet in dfs:
        df_p = dfs[parent_sheet].copy()
        
        # Mapped columns in parent
        col_vendor = mappings.get('vendor', {}).get('column') if mappings.get('vendor') else None
        col_accuracy = mappings.get('accuracy', {}).get('column') if mappings.get('accuracy') else None
        col_doc_id = mappings.get('document_id', {}).get('column') if mappings.get('document_id') else None
        col_rel_parent = mappings.get('relationship_key_parent', {}).get('column') if mappings.get('relationship_key_parent') else None
        
        # Trim whitespace from all string columns
        for col in df_p.columns:
            if df_p[col].dtype == object:
                df_p[col] = df_p[col].apply(lambda x: str(x).strip() if not pd.isna(x) and x is not None else x)
                
        # Clean percentage
        if col_accuracy and col_accuracy in df_p.columns:
            df_p[col_accuracy] = clean_percentage_series(df_p[col_accuracy])
            
        # Drop duplicates
        df_p.drop_duplicates(inplace=True)
        
        # Filter out rows where critical fields are invalid
        critical_cols = []
        if col_vendor: critical_cols.append(col_vendor)
        if col_accuracy: critical_cols.append(col_accuracy)
        if col_doc_id: critical_cols.append(col_doc_id)
        if col_rel_parent: critical_cols.append(col_rel_parent)
        
        mask = pd.Series(True, index=df_p.index)
        for col in critical_cols:
            if col in df_p.columns:
                mask = mask & (~df_p[col].apply(is_invalid))
        df_p = df_p[mask]
        
        df_parent = df_p
        
    # Clean Child Sheet
    if child_sheet and child_sheet in dfs:
        # Check if child is different from parent or if we are analyzing a single sheet as parent+child
        df_c = dfs[child_sheet].copy()
        
        # Mapped columns in child
        col_name = mappings.get('column_name', {}).get('column') if mappings.get('column_name') else None
        col_match = mappings.get('matching_percentage', {}).get('column') if mappings.get('matching_percentage') else None
        col_rel_child = mappings.get('relationship_key_child', {}).get('column') if mappings.get('relationship_key_child') else None
        
        # Trim whitespace from all string columns
        for col in df_c.columns:
            if df_c[col].dtype == object:
                df_c[col] = df_c[col].apply(lambda x: str(x).strip() if not pd.isna(x) and x is not None else x)
                
        # Clean percentage
        if col_match and col_match in df_c.columns:
            df_c[col_match] = clean_percentage_series(df_c[col_match])
            
        # Drop duplicates
        df_c.drop_duplicates(inplace=True)
        
        # Filter out rows where critical fields are invalid
        critical_cols = []
        if col_name: critical_cols.append(col_name)
        if col_match: critical_cols.append(col_match)
        if col_rel_child: critical_cols.append(col_rel_child)
        
        mask = pd.Series(True, index=df_c.index)
        for col in critical_cols:
            if col in df_c.columns:
                mask = mask & (~df_c[col].apply(is_invalid))
        df_c = df_c[mask]
        
        df_child = df_c
        
    # Join parent and child if relationship keys are present
    df_joined = None
    if df_parent is not None and df_child is not None and parent_sheet != child_sheet:
        col_rel_parent = mappings.get('relationship_key_parent', {}).get('column') if mappings.get('relationship_key_parent') else None
        col_rel_child = mappings.get('relationship_key_child', {}).get('column') if mappings.get('relationship_key_child') else None
        
        if col_rel_parent and col_rel_child and col_rel_parent in df_parent.columns and col_rel_child in df_child.columns:
            try:
                # Align types for join
                # Check if columns are convertible to numeric first
                df_p_temp = df_parent.copy()
                df_c_temp = df_child.copy()
                try:
                    # Convert to float to align keys (handles e.g. 1796.0 and '1796' alignment)
                    df_p_temp['_rel_key'] = pd.to_numeric(df_parent[col_rel_parent]).astype(float)
                    df_c_temp['_rel_key'] = pd.to_numeric(df_child[col_rel_child]).astype(float)
                except Exception:
                    # Fallback to trimmed string
                    df_p_temp['_rel_key'] = df_parent[col_rel_parent].astype(str).str.strip()
                    df_c_temp['_rel_key'] = df_child[col_rel_child].astype(str).str.strip()
                
                df_joined = pd.merge(df_p_temp, df_c_temp, on='_rel_key', suffixes=('_parent', '_child'))
                df_joined.drop(columns=['_rel_key'], inplace=True)
            except Exception as e:
                print(f"Error joining sheets: {str(e)}")
                df_joined = None
                
    # Fallback/independent analysis
    if df_parent is not None and df_joined is None:
        df_joined = df_parent.copy()
        
    return df_parent, df_child, df_joined
