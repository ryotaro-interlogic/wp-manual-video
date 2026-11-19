#!/usr/bin/env python3
"""deck.json の文章を references/writing-guide.md の決まりで点検し、直す候補を出す。

  python3 -I check_text.py deck.json

言葉の候補を機械的に出すだけで、文の意味や正しさは判断しない。
候補を1つずつ読み、直すかどうかは人（または Claude）が決める。
終了コード：0 候補なし / 1 候補あり / 2 実行エラー
"""
import json
import re
import sys

# 使わない言葉 → 使う言葉（writing-guide.md の 3）
WORDS = [
    (r'押す|押して|押し(?=て|ま|た)|押すと|を押', '「クリック」に'),
    (r'マウスを乗せ', '「カーソルをあわせて」に'),
    (r'ふだん', '「通常時」に'),
    (r'(?<![現])いま(?![す])|今の', '「現在の」に'),
    (r'選ぶ|選んで|選び', '「選択」に'),
    (r'に出る|が出る|出ます', '「表示される」に'),
    (r'してみましょう|便利です|簡単に', '呼びかけ・感想は書かない'),
    (r'有効|最適|効率化|可視化|最大化|向上', '抽象語。具体的な操作と結果に'),
    (r'制作会社', '連絡先の会社名を書く（site.json の contact）'),
    (r'表の(左|右)側|画面の(左|右)側の見出し', '位置ではなく欄の名前で書く'),
    (r'して下さい|して頂', '補助動詞はひらがな（ください・いただく）'),
    (r'する事|した事|の時は', '形式名詞はひらがな（こと・とき）'),
]
# 撮影日のサイトの状態に頼った注意書き
STATE = r'のままです|まだ(更新|変更)されていません|現在は.*になっています'

# 説明文の終わり方（writing-guide.md の 2）
BAD_END = [
    (r'に$', '「〜に」で途切れている。言い切るか「」で止める'),
    (r'なし$', '名詞で止めている。「〜されません」などで言い切る'),
    (r'[一-龥ァ-ヶー]$', '名詞で止めている。「〜されます」「〜します」で言い切る'),
]

LIMIT = {'step': 40, 'note_side': 50, 'note_full': 70}


def texts(deck):
    """(場所, 種類, 文) を順に返す"""
    for i, sl in enumerate(deck.get('slides', []), 1):
        t = sl.get('type')
        where = f'スライド{i}（{t}）'
        if sl.get('title'):
            yield where, 'title', sl['title']
        if sl.get('sub'):
            yield where, 'sub', sl['sub']
        if sl.get('where'):
            yield where, 'where', sl['where']
        for n, st in enumerate(sl.get('steps') or [], 1):
            yield f'{where} 手順{n}', 'step_head', st[0]
            if len(st) > 1 and st[1]:
                yield f'{where} 手順{n}', 'step', st[1]
        for n, c in enumerate(sl.get('cards') or [], 1):
            yield f'{where} カード{n}', 'card_head', c[0]
            if len(c) > 1 and c[1]:
                yield f'{where} カード{n}', 'card', c[1]
        for row in sl.get('rows') or []:
            for c in row:
                yield f'{where} 表', 'cell', c
        if sl.get('note'):
            side = t in ('shot', 'place')
            yield f'{where} note', 'note_side' if side else 'note_full', sl['note']['text']
        ex = sl.get('extra')
        if ex:
            for l in ex.get('lines', []):
                yield f'{where} extra', 'extra', l
        say = sl.get('say') or {}
        for s in say.get('intro', []):
            yield f'{where} say', 'say', s
        for grp in say.get('steps', []):
            for s in grp:
                yield f'{where} say', 'say', s


def check(deck):
    out = []
    for loc, kind, text in texts(deck):
        plain = re.sub(r'https?://\S+', '', text)  # URL は対象外
        for pat, msg in WORDS:
            m = re.search(pat, plain)
            if m:
                out.append((loc, f'「{m.group(0)}」→ {msg}', text))
        if re.search(STATE, plain):
            out.append((loc, '撮影日のサイトの状態に頼った書き方。古くなるのでユーザーへの報告に回す', text))
        if kind in ('step', 'card', 'note_side', 'note_full', 'extra'):
            body = plain.rstrip('。 　')
            for pat, msg in BAD_END:
                if re.search(pat, body):
                    out.append((loc, msg, text))
                    break
        if kind in LIMIT and len(text) > LIMIT[kind]:
            out.append((loc, f'{len(text)}字。目安 {LIMIT[kind]}字を超えている（はみ出しに注意）', text))
        if kind == 'say' and len(text) > 40:
            out.append((loc, f'{len(text)}字。字幕が2行を超えるかもしれない', text))

    # 画面スライドに「この編集機能があるページ」が無い
    for i, sl in enumerate(deck.get('slides', []), 1):
        if sl.get('type') == 'shot' and not sl.get('where') and not sl.get('noWhere'):
            out.append((f'スライド{i}（shot）', '`where`（この編集機能があるページ）が無い。ログイン画面など不要なら "noWhere": true', sl.get('title', '')))
    return out


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    try:
        with open(sys.argv[1], encoding='utf-8') as f:
            deck = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print('ERROR:', e, file=sys.stderr)
        return 2
    found = check(deck)
    if not found:
        print('候補なし。ただし欄の名前が画面と同じか、意味が変わっていないかは、画面と並べて確かめてください。')
        return 0
    for loc, msg, text in found:
        print(f'{loc}: {msg}\n    {text}')
    print(f'\n{len(found)}件。機械的な候補なので、意味を読んで直すかどうか決めてください。')
    return 1


if __name__ == '__main__':
    sys.exit(main())
