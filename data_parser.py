import os
import pandas as pd

def parse_file(file_path, file_extension=None):
    """
    Parses an uploaded file (xlsx, csv, jsonl) and returns a dictionary of DataFrames.
    Keys are sheet names (for Excel) or a default name 'Sheet1' (for CSV/JSONL).
    """
    if not file_extension:
        _, ext = os.path.splitext(file_path)
        ext = ext.lower()
    else:
        ext = file_extension.lower()
        if not ext.startswith('.'):
            ext = '.' + ext

    if ext in ['.xlsx', '.xls']:
        try:
            excel_file = pd.ExcelFile(file_path)
            sheet_names = excel_file.sheet_names
            if not sheet_names:
                raise ValueError("The uploaded Excel file has no worksheets.")
            
            dfs = {}
            for sheet in sheet_names:
                df = pd.read_excel(excel_file, sheet_name=sheet)
                dfs[sheet] = df
            return dfs
        except Exception as e:
            raise ValueError(f"Failed to parse Excel file: {str(e)}")

    elif ext == '.csv':
        try:
            df = pd.read_csv(file_path)
            return {"Sheet1": df}
        except Exception as e:
            raise ValueError(f"Failed to parse CSV file: {str(e)}")

    elif ext in ['.jsonl', '.json']:
        try:
            try:
                df = pd.read_json(file_path, lines=True)
            except Exception:
                df = pd.read_json(file_path)
            return {"Sheet1": df}
        except Exception as e:
            raise ValueError(f"Failed to parse JSONL/JSON file: {str(e)}")

    else:
        raise ValueError(f"Unsupported file format: {ext}")
