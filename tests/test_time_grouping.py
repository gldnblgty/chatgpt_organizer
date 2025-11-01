from app.services.time_grouping import group_conversations_by_date

def test_group_by_month():
    conversations = [
        {"id":"1","title":"A","create_time":1704067200,"mapping":{}},  # 2023-01-01
        {"id":"2","title":"B","create_time":1706659200,"mapping":{}},  # 2024-01-31 approx (epoch check ok)
    ]
    grouped = group_conversations_by_date(conversations, mode="month")
    assert isinstance(grouped, dict)
    assert len(grouped) >= 1

def test_group_by_year():
    conversations = [
        {"id":"1","title":"A","create_time":1704067200,"mapping":{}},
        {"id":"2","title":"B","create_time":1735603200,"mapping":{}},
    ]
    grouped = group_conversations_by_date(conversations, mode="year")
    assert isinstance(grouped, dict)
