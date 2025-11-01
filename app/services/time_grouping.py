from datetime import datetime

def format_timestamp(timestamp):
    if timestamp:
        try:
            return datetime.fromtimestamp(float(timestamp)).strftime('%Y-%m-%d %H:%M')
        except:
            return "Unknown"
    return "Unknown"

def pretty_month(dt_str: str) -> str:
    try:
        dt = datetime.strptime(dt_str, '%Y-%m-%d %H:%M')
        return dt.strftime('%B %Y')
    except Exception:
        return 'Unknown'

def year_only(dt_str: str) -> str:
    try:
        dt = datetime.strptime(dt_str, '%Y-%m-%d %H:%M')
        return dt.strftime('%Y')
    except Exception:
        return 'Unknown'

def extract_messages_from_mapping(mapping):
    messages = []
    if mapping:
        for _, msg_data in mapping.items():
            if 'message' in msg_data and msg_data['message']:
                messages.append(msg_data['message'])
    return messages

def group_conversations_by_date(conversations, mode="month"):
    result = {}
    for conv in conversations:
        mapping = conv.get('mapping', {}) or {}
        messages = extract_messages_from_mapping(mapping)
        create_time = conv.get('create_time')
        date_str = format_timestamp(create_time)
        info = {
            "title": conv.get('title', 'Untitled'),
            "id": conv.get('id', 'unknown'),
            "create_time": date_str,
            "update_time": format_timestamp(conv.get('update_time')),
            "message_count": len(messages)
        }
        period = year_only(date_str) if mode == "year" else pretty_month(date_str)
        result.setdefault(period, {}).setdefault("All", []).append(info)

    # 🧩 Sort the outer keys (month/year buckets)
    from datetime import datetime

    def _period_sort_key(p: str, mode: str):
        if p == 'Unknown':
            return datetime.min
        try:
            if mode == "year":
                return datetime.strptime(p, "%Y")
            # mode == "month"
            return datetime.strptime(p, "%B %Y")
        except Exception:
            return datetime.min

    ordered = {}
    for period in sorted(result.keys(), key=lambda p: _period_sort_key(p, mode), reverse=True):
        ordered[period] = result[period]
    result = ordered

    # 📅 Sort conversations within each bucket
    for period in result:
        for category in result[period]:
            result[period][category] = sorted(
                result[period][category],
                key=lambda c: datetime.strptime(c['create_time'], '%Y-%m-%d %H:%M')
                if c['create_time'] != 'Unknown' else datetime.min,
                reverse=True
            )

    return result


    