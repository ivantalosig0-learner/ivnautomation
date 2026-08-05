#!/usr/bin/env python3
"""Rewrite generate_outreach -> v3 to match composer v3.

The old v2 prompt produced a different voice from the deterministic composer,
so on the ~11% of calls the gateway actually served, the recipient got a
noticeably different email from everyone else. v3 pins the AI to the same
rules the composer follows.
"""
import re, sys, shutil, datetime

PATH = "/opt/ivnautomation-ai/gateway/app/prompts/library.py"

NEW_OUTREACH = '''_register(PromptSpec(
    id="generate_outreach",
    version="v3",
    system=(
        f"{_BRAND}\\n"
        "TASK: Write ONE short cold outreach email TO the business in the input "
        "JSON (the recipient), FROM the sender. Never greet or address the "
        "sender. Always name the sending company using the exact value of "
        "sender.company.\\n"
        "The 'notes' field tells you which service to pitch, which pain to "
        "name, the proof point to use, and what to ask to price. Use them; do "
        "not substitute a generic cleaning pitch.\\n"
        "HARD RULES:\\n"
        "- Body 90-130 words. Shorter beats longer.\\n"
        "- Open with something specific about THEM drawn from business.name, "
        "business.description or business.location. Never open with a "
        "sentence about us.\\n"
        "- Exactly one ask, and it must be a yes/no question offering a fixed "
        "written price for the thing named in notes. Never ask for a meeting, "
        "a call, or '10 minutes'.\\n"
        "- Include one trust line: Adelaide-based, public liability cover, "
        "police-checked cleaners, documentation on request.\\n"
        "- Sign off with sender.name, then sender.company, then sender.phone "
        "on separate lines.\\n"
        "- Plain text only. No links, no bullet points, no markdown, no "
        "placeholders such as [Name], no emojis, no exclamation marks.\\n"
        "- If contact_name is null, greet the team by business name.\\n"
        "SUBJECT: max 60 characters, lowercase-natural, as if typed by a "
        "person. Never append a parenthetical offer such as '(quick quote "
        "offer)'. Never use the words free, offer, deal, discount, or "
        "guarantee. Do not stuff the business name and suburb together.\\n"
        'Return JSON: {"subject": string, "email_body": string, '
        '"personalization_used": string, "call_to_action": string, '
        '"word_count": integer}\\n'
        f"{_JSON_RULES}"
    ),
    required_keys=["subject", "email_body", "personalization_used", "call_to_action"],
    temperature=0.5,
))'''

NEW_FOLLOWUP = '''_register(PromptSpec(
    id="generate_followup",
    version="v3",
    system=(
        f"{_BRAND}\\n"
        "TASK: Write a follow-up email TO the business in the input JSON, FROM "
        "the sender. Never greet or address the sender. Use the exact value of "
        "sender.company. Input includes the original outreach email, "
        "sequence_number, days_since_last_contact and notes.\\n"
        "Sequence rules:\\n"
        "1 = two sentences maximum. Acknowledge the earlier note, then ask "
        "whether to send a fixed price for the item in notes. Nothing else.\\n"
        "2 = lead with the proof point in notes as NEW information. Explicitly "
        "give them permission to already have a cleaner, and offer to be the "
        "backup number on file.\\n"
        "3 or higher = final note. Invite a one-word 'not now' reply so they "
        "can close the loop without awkwardness. Set is_final true.\\n"
        "HARD RULES: body 40-80 words, plain text, no links, no markdown, no "
        "placeholders, no exclamation marks. Never guilt-trip, never say "
        "'just following up again' or 'circling back'. Never repeat sentences "
        "from the original email. Sign off with sender.name, sender.company "
        "and sender.phone on separate lines.\\n"
        'Return JSON: {"email_body": string, "angle": string, '
        '"is_final": boolean, "word_count": integer}\\n'
        f"{_JSON_RULES}"
    ),
    required_keys=["email_body", "angle", "is_final"],
    temperature=0.5,
))'''

src = open(PATH, encoding="utf-8").read()
shutil.copy(PATH, PATH + ".bak-" + datetime.datetime.now().strftime("%Y%m%d%H%M%S"))

def replace_block(src, prompt_id, new_block):
    start = src.index('_register(PromptSpec(\n    id="%s"' % prompt_id)
    end = src.index('))', src.index('required_keys', start)) + 2
    return src[:start] + new_block + src[end:]

src = replace_block(src, "generate_outreach", NEW_OUTREACH)
src = replace_block(src, "generate_followup", NEW_FOLLOWUP)
open(PATH, "w", encoding="utf-8").write(src)
print("patched generate_outreach v3 + generate_followup v3")
