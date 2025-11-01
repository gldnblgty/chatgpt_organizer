import json
import time
from collections import defaultdict
from datetime import datetime
from typing import Any, Callable, Dict, List, Tuple, Optional

from openai import OpenAI

ProgressCB = Optional[Callable[[int, int], None]]

class ChatGPTCategorizer:
    """
    Uses OpenAI to categorize conversations into a single category each.

    Security hardening:
      - Requires explicit api_key parameter (no env lookup).
      - Does not store the api_key on self.
      - Sets client timeouts.
      - Avoids logging/printing sensitive content.
    """
    def __init__(self, api_key: str, timeout_seconds: float = 45.0):
        if not (isinstance(api_key, str) and api_key.startswith("sk-")):
            raise ValueError("Valid OpenAI API key is required.")
        # Do NOT keep api_key on the instance; hand it straight to the client.
        self._client = OpenAI(api_key=api_key, timeout=timeout_seconds)

        self.default_categories = [
            'Programming & Development',
            'Writing & Content Creation',
            'Learning & Education',
            'Creative & Design',
            'Business & Strategy',
            'Personal Advice',
            'Technical Support',
            'Research & Analysis',
            'Data Science & ML',
            'Career & Professional'
        ]

    # ---------- Helpers ----------
    def format_timestamp(self, ts) -> str:
        if ts is None:
            return "Unknown"
        try:
            return datetime.fromtimestamp(float(ts)).strftime('%Y-%m-%d %H:%M')
        except Exception:
            return "Unknown"

    def extract_messages_from_mapping(self, mapping: dict) -> list:
        out = []
        if not mapping:
            return out
        for _, node in mapping.items():
            msg = node.get('message')
            if msg:
                out.append(msg)
        try:
            out.sort(key=lambda m: (m.get('create_time') or 0))
        except Exception:
            pass
        return out

    def extract_conversation_summary(self, title: str, messages: list, max_chars: int = 2000) -> str:
        parts = [f"Title: {title}"]
        for msg in messages[:5]:
            try:
                content = msg.get('content')
                if isinstance(content, dict) and 'parts' in content:
                    for part in content['parts'][:2]:
                        if isinstance(part, str):
                            parts.append(part[:300])
                elif isinstance(content, str):
                    parts.append(content[:300])
                else:
                    for k in ('text', 'message', 'content'):
                        if isinstance(msg.get(k), str):
                            parts.append(msg[k][:300])
                            break
            except Exception:
                continue
        return '\n'.join(parts)[:max_chars]

    # ---------- OpenAI call ----------
    def batch_categorize_with_gpt(
        self,
        conversations_batch: List[Tuple[str, list]],
        custom_categories: Optional[List[str]] = None
    ) -> List[str]:
        categories = custom_categories or self.default_categories

        conv_summaries = []
        for idx, (title, messages) in enumerate(conversations_batch):
            summary = self.extract_conversation_summary(title, messages)
            conv_summaries.append(f"Conversation {idx + 1}:\n{summary}\n")

        batch_text = "\n---\n".join(conv_summaries)

        user_prompt = f"""Categorize each ChatGPT conversation into ONE of these categories:

Categories: {', '.join(categories)}

{batch_text}

Respond ONLY as JSON with this exact shape and never use "Uncategorized" category:
{{"categories": ["Programming & Development", "Writing & Content Creation", "..."]}}

- The array length MUST equal the number of conversations.
- If none fits, propose a new single category name at that position.
"""

        try:
            resp = self._client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a precise conversation categorizer. Output strict JSON only."},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.2,
                max_tokens=500,
                response_format={"type": "json_object"}
            )
            content = resp.choices[0].message.content
            data = json.loads(content)
            arr = data.get("categories", [])
            if not isinstance(arr, list) or len(arr) != len(conversations_batch):
                raise ValueError("Model did not return a categories array with correct length.")
            return [str(x) for x in arr]
        except Exception:
            # Do not leak prompts or payload details in logs.
            return ["Uncategorized"] * len(conversations_batch)

    # ---------- Main ----------
    def process_export(
        self,
        filepath: str,
        custom_categories: Optional[List[str]] = None,
        batch_size: int = 25,
        max_concurrency: int = 4,  # reserved for future parallelization
        progress_cb: ProgressCB = None
    ) -> Dict[str, List[dict]]:
        """
        Returns: { category: [conv_info, ...] }
        conv_info = { title, id, create_time, update_time, message_count, category }
        """
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        conversations = data if isinstance(data, list) else [data]
        all_items: List[Tuple[str, list, dict]] = []

        for conv in conversations:
            title = conv.get('title', 'Untitled')
            messages = self.extract_messages_from_mapping(conv.get('mapping', {}) or {})
            info = {
                "title": title,
                "id": conv.get('id', 'unknown'),
                "create_time": self.format_timestamp(conv.get('create_time')),
                "update_time": self.format_timestamp(conv.get('update_time')),
                "message_count": len(messages)
            }
            all_items.append((title, messages, info))

        total = len(all_items)
        if progress_cb:
            progress_cb(0, total)

        categorized = defaultdict(list)
        processed = 0

        for i in range(0, total, batch_size):
            batch = all_items[i:i + batch_size]
            batch_data = [(t, m) for (t, m, _) in batch]
            cats = self.batch_categorize_with_gpt(batch_data, custom_categories=custom_categories)

            for idx, (title, messages, info) in enumerate(batch):
                category = cats[idx] if idx < len(cats) else "Uncategorized"
                info_out = dict(info)
                info_out["category"] = category
                categorized[category].append(info_out)
                processed += 1
                if progress_cb:
                    progress_cb(processed, total)

            if i + batch_size < total:
                time.sleep(0.15)

        def dt_key(ci):
            s = ci.get('create_time', 'Unknown')
            try:
                return datetime.strptime(s, '%Y-%m-%d %H:%M')
            except Exception:
                return datetime.min

        for k in list(categorized.keys()):
            categorized[k] = sorted(categorized[k], key=dt_key, reverse=True)

        return dict(categorized)
