import pandas as pd
import numpy as np
from cleaner import is_invalid, is_valid_vendor_name


def _col(mappings, key):
    """Safely get the column name from a mapping dict entry that may be None."""
    entry = mappings.get(key)
    if not entry:
        return None
    return entry.get('column') if isinstance(entry, dict) else None


def get_overview_stats(df_parent, mappings):
    col_accuracy = _col(mappings, 'accuracy')
    if df_parent is None or not col_accuracy or col_accuracy not in df_parent.columns:
        return {
            'total_records': 0,
            'avg_accuracy': 0.0,
            'min_accuracy': 0.0,
            'max_accuracy': 0.0
        }

    total = len(df_parent)
    accuracies = df_parent[col_accuracy].dropna()

    return {
        'total_records': total,
        'avg_accuracy': round(float(accuracies.mean()), 2) if not accuracies.empty else 0.0,
        'min_accuracy': round(float(accuracies.min()), 2) if not accuracies.empty else 0.0,
        'max_accuracy': round(float(accuracies.max()), 2) if not accuracies.empty else 0.0
    }


def get_vendor_analysis(df_parent, mappings):
    col_vendor = _col(mappings, 'vendor')
    col_accuracy = _col(mappings, 'accuracy')

    if (df_parent is None or not col_vendor or col_vendor not in df_parent.columns
            or not col_accuracy or col_accuracy not in df_parent.columns):
        return {'bins': {}, 'vendors': []}

    # Filter out rows where vendor is invalid
    df = df_parent[~df_parent[col_vendor].apply(is_invalid)].copy()
    df = df[df[col_vendor].apply(lambda x: is_valid_vendor_name(str(x)))]

    # Group by vendor
    grouped = df.groupby(col_vendor).agg(
        avg_accuracy=(col_accuracy, 'mean'),
        doc_count=(col_accuracy, 'count')
    ).reset_index()

    bin_labels = ['0-20', '20-40', '40-60', '60-80', '80-100']

    def get_bin(val):
        if pd.isna(val):
            return 'Unknown'
        if val <= 20: return '0-20'
        if val <= 40: return '20-40'
        if val <= 60: return '40-60'
        if val <= 80: return '60-80'
        return '80-100'

    grouped['bin'] = grouped['avg_accuracy'].apply(get_bin)

    # Bin counts
    bin_counts = {label: 0 for label in bin_labels}
    for b in grouped['bin']:
        if b in bin_counts:
            bin_counts[b] += 1

    # Format vendor list
    vendors = []
    for _, row in grouped.iterrows():
        avg = float(row['avg_accuracy'])
        if pd.isna(avg):
            continue
        vendors.append({
            'name': str(row[col_vendor]),
            'avg_accuracy': round(avg, 2),
            'doc_count': int(row['doc_count']),
            'bin': row['bin']
        })

    vendors = sorted(vendors, key=lambda x: x['avg_accuracy'], reverse=True)

    return {'bins': bin_counts, 'vendors': vendors}


def get_vendor_details(df_parent, df_joined, vendor_name, mappings):
    col_vendor = _col(mappings, 'vendor')
    col_accuracy = _col(mappings, 'accuracy')

    if df_parent is None or not col_vendor or col_vendor not in df_parent.columns or not col_accuracy or col_accuracy not in df_parent.columns:
        return None

    if not is_valid_vendor_name(str(vendor_name)):
        return None

    df_vendor = df_parent[df_parent[col_vendor] == vendor_name]
    if df_vendor.empty:
        return None

    doc_count = len(df_vendor)
    avg_acc = float(df_vendor[col_accuracy].mean())
    min_acc = float(df_vendor[col_accuracy].min())
    max_acc = float(df_vendor[col_accuracy].max())

    columns_handled = []
    columns_with_errors = []

    col_name = _col(mappings, 'column_name')
    col_match = _col(mappings, 'matching_percentage')

    # Detect OCR / expected value columns for missing % computation
    ocr_col = None
    if df_joined is not None:
        for c in df_joined.columns:
            c_low = c.lower()
            if 'ocr' in c_low and 'value' in c_low:
                ocr_col = c
                break

    if (df_joined is not None
            and col_vendor in df_joined.columns
            and col_name and col_name in df_joined.columns
            and col_match and col_match in df_joined.columns):

        df_j_vendor = df_joined[df_joined[col_vendor] == vendor_name]

        if not df_j_vendor.empty:
            missing_series_col = ocr_col if ocr_col else col_match

            col_grouped = df_j_vendor.groupby(col_name).agg(
                total_checks=(col_match, 'count'),
                avg_matching=(col_match, 'mean'),
                failure_count=(col_match, lambda x: (x < 100.0).sum()),
                missing_count=(
                    missing_series_col,
                    lambda x: x.apply(is_invalid).sum() if ocr_col else (x == 0.0).sum()
                )
            ).reset_index()

            for _, row in col_grouped.iterrows():
                tot = int(row['total_checks'])
                fail_cnt = int(row['failure_count'])
                miss_cnt = int(row['missing_count'])
                avg_m = float(row['avg_matching']) if not pd.isna(row['avg_matching']) else 0.0

                columns_handled.append({
                    'name': str(row[col_name]),
                    'total_checks': tot,
                    'avg_matching': round(avg_m, 2),
                    'failure_count': fail_cnt,
                    'failure_percent': round((fail_cnt / tot) * 100.0, 2) if tot > 0 else 0.0,
                    'missing_count': miss_cnt,
                    'missing_percent': round((miss_cnt / tot) * 100.0, 2) if tot > 0 else 0.0
                })

            columns_with_errors = [c for c in columns_handled if c['avg_matching'] < 100.0]

    return {
        'vendor_name': vendor_name,
        'doc_count': doc_count,
        'avg_accuracy': round(avg_acc, 2),
        'min_accuracy': round(min_acc, 2),
        'max_accuracy': round(max_acc, 2),
        'columns_handled': columns_handled,
        'columns_with_errors': columns_with_errors
    }


def get_column_analysis(df_joined, df_child, mappings):
    col_name = _col(mappings, 'column_name')
    col_match = _col(mappings, 'matching_percentage')

    df = df_joined if df_joined is not None else df_child

    if df is None or not col_name or col_name not in df.columns or not col_match or col_match not in df.columns:
        return []

    # Filter out rows with invalid column names (NULL, NaN, ???, ----, blank, etc.)
    df = df[~df[col_name].apply(is_invalid)].copy()


    ocr_col = None
    for c in df.columns:
        c_low = c.lower()
        if 'ocr' in c_low and 'value' in c_low:
            ocr_col = c
            break

    missing_series_col = ocr_col if ocr_col else col_match

    col_grouped = df.groupby(col_name).agg(
        total_checks=(col_match, 'count'),
        avg_matching=(col_match, 'mean'),
        failure_count=(col_match, lambda x: (x < 100.0).sum()),
        missing_count=(
            missing_series_col,
            lambda x: x.apply(is_invalid).sum() if ocr_col else (x == 0.0).sum()
        )
    ).reset_index()

    columns = []
    for _, row in col_grouped.iterrows():
        tot = int(row['total_checks'])
        fail_cnt = int(row['failure_count'])
        miss_cnt = int(row['missing_count'])
        avg_m = float(row['avg_matching']) if not pd.isna(row['avg_matching']) else 0.0

        col_rows = df[df[col_name] == row[col_name]][col_match].dropna()
        dist = {
            '0-20': int((col_rows <= 20).sum()),
            '20-40': int(((col_rows > 20) & (col_rows <= 40)).sum()),
            '40-60': int(((col_rows > 40) & (col_rows <= 60)).sum()),
            '60-80': int(((col_rows > 60) & (col_rows <= 80)).sum()),
            '80-100': int(((col_rows > 80) & (col_rows <= 100)).sum())
        }

        columns.append({
            'name': str(row[col_name]),
            'total_checks': tot,
            'avg_matching': round(avg_m, 2),
            'failure_percent': round((fail_cnt / tot) * 100.0, 2) if tot > 0 else 0.0,
            'missing_percent': round((miss_cnt / tot) * 100.0, 2) if tot > 0 else 0.0,
            'distribution': dist
        })

    return columns


def get_time_analysis(df_parent, mappings, num_segments=8, reference_column='start_time'):
    if df_parent is None or df_parent.empty:
        return {'segments': [], 'has_time_data': False, 'has_duration_data': False}

    col_start = _col(mappings, 'start_time')
    col_end = _col(mappings, 'end_time')

    # Fallback to standard names if not mapped
    if not col_start and 'HEXT_Processing_Start_Time' in df_parent.columns:
        col_start = 'HEXT_Processing_Start_Time'
    if not col_end and 'HEXT_Processing_End_Time' in df_parent.columns:
        col_end = 'HEXT_Processing_End_Time'

    ref_col = col_start if reference_column == 'start_time' else col_end
    if not ref_col or ref_col not in df_parent.columns:
        # Try the other one as fallback
        ref_col = col_end if reference_column == 'start_time' else col_start
        if not ref_col or ref_col not in df_parent.columns:
            return {'segments': [], 'has_time_data': False, 'has_duration_data': False}

    # Find if there is a separate Hour column
    hour_col = None
    for col in df_parent.columns:
        if col.lower() == 'hour':
            hour_col = col
            break

    df = df_parent.copy()
    
    # Parse the reference column if no Hour column is present
    if hour_col:
        df['_hour'] = pd.to_numeric(df[hour_col], errors='coerce')
    else:
        df['_ref_dt'] = pd.to_datetime(df[ref_col], errors='coerce')
        df['_hour'] = df['_ref_dt'].dt.hour

    # Filter out rows with invalid hour (NaT/NaN)
    df = df[df['_hour'].notna() & (df['_hour'] >= 0) & (df['_hour'] < 24)]
    if df.empty:
        return {'segments': [], 'has_time_data': False, 'has_duration_data': False}

    # Parse start and end times for duration calculations if both are present
    has_duration = False
    if col_start in df.columns and col_end in df.columns:
        df['_start_dt'] = pd.to_datetime(df[col_start], errors='coerce')
        df['_end_dt'] = pd.to_datetime(df[col_end], errors='coerce')
        df['_duration'] = (df['_end_dt'] - df['_start_dt']).dt.total_seconds()
        # Drop negative durations
        df.loc[df['_duration'] < 0, '_duration'] = np.nan
        has_duration = df['_duration'].notna().any()

    # Generate segments
    if num_segments not in [2, 3, 4, 6, 8, 12, 24]:
        num_segments = 8
    hours_per_segment = 24 // num_segments

    # Accuracy column
    col_accuracy = _col(mappings, 'accuracy')
    if not col_accuracy or col_accuracy not in df.columns:
        # Fallback to standard accuracy if present
        if 'HEXT_Accuracy_Percentage' in df.columns:
            col_accuracy = 'HEXT_Accuracy_Percentage'

    segments_data = []
    total_records_with_time = len(df)

    for i in range(num_segments):
        start_hour = i * hours_per_segment
        end_hour = (i + 1) * hours_per_segment - 1
        label = f"{start_hour:02d}:00 - {end_hour:02d}:59"

        # Filter df for this segment
        seg_df = df[(df['_hour'] >= start_hour) & (df['_hour'] <= end_hour)]
        count = len(seg_df)
        pct = round((count / total_records_with_time) * 100.0, 2) if total_records_with_time > 0 else 0.0

        # Accuracy stats
        avg_acc = 0.0
        acc_dist = {'0-20': 0, '20-40': 0, '40-60': 0, '60-80': 0, '80-100': 0}
        if count > 0 and col_accuracy:
            acc_series = seg_df[col_accuracy].dropna()
            if not acc_series.empty:
                avg_acc = round(float(acc_series.mean()), 2)
                acc_dist['0-20'] = int((acc_series <= 20).sum())
                acc_dist['20-40'] = int(((acc_series > 20) & (acc_series <= 40)).sum())
                acc_dist['40-60'] = int(((acc_series > 40) & (acc_series <= 60)).sum())
                acc_dist['60-80'] = int(((acc_series > 60) & (acc_series <= 80)).sum())
                acc_dist['80-100'] = int(((acc_series > 80) & (acc_series <= 100)).sum())

        # Duration stats
        dur_stats = None
        if has_duration and count > 0:
            dur_series = seg_df['_duration'].dropna()
            if not dur_series.empty:
                dur_dist = {
                    '0-30s': int((dur_series <= 30).sum()),
                    '30-60s': int(((dur_series > 30) & (dur_series <= 60)).sum()),
                    '60-120s': int(((dur_series > 60) & (dur_series <= 120)).sum()),
                    '120-300s': int(((dur_series > 120) & (dur_series <= 300)).sum()),
                    '300s+': int((dur_series > 300).sum())
                }
                dur_stats = {
                    'avg': round(float(dur_series.mean()), 2),
                    'min': round(float(dur_series.min()), 2),
                    'max': round(float(dur_series.max()), 2),
                    'median': round(float(dur_series.median()), 2),
                    'distribution': dur_dist
                }

        segments_data.append({
            'label': label,
            'start_hour': start_hour,
            'end_hour': end_hour,
            'record_count': count,
            'percentage': pct,
            'avg_accuracy': avg_acc,
            'accuracy_distribution': acc_dist,
            'duration': dur_stats
        })

    # Overall duration stats
    overall_dur = None
    if has_duration:
        overall_series = df['_duration'].dropna()
        if not overall_series.empty:
            overall_dur = {
                'avg': round(float(overall_series.mean()), 2),
                'min': round(float(overall_series.min()), 2),
                'max': round(float(overall_series.max()), 2),
                'median': round(float(overall_series.median()), 2)
            }

    return {
        'segments': segments_data,
        'has_time_data': True,
        'has_duration_data': has_duration,
        'overall_duration_stats': overall_dur
    }

