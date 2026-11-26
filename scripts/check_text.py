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

# 見出しを言い換えただけの説明かを見るときに取り除く、ありふれた言い回し（writing-guide.md の 5）
FILLER = r'を|が|は|の|に|、|。|入力|クリック|選択|します|されます|できます|ます|内容|変更|管理者|ください|して'
# note が手順や情報だけになっていないか（writing-guide.md の 6）
NOTE_PROC = r'(クリック|入力|選択)します。?$'
NOTE_RISK = r'ない|ません|消え|戻せ|削除|変え|届か|影響|使用中'
# タイトルの形（writing-guide.md の 7）
TITLE_FORMS = [
    (r'^「[^」]+」(を|で)', 'ボタン名で始まる形（「〇〇」で／を〜）'),
    (r'をクリックして', '「〜をクリックして〜」の形'),
]


def body_is_echo(head, body):
    """説明が見出しの言い換えだけか（見出しの中心の語を取り除くと、ありふれた言い回ししか残らないか）"""
    core = re.sub(r'[「」]|を?(入力|クリック|選択|確認)$|（任意）', '', head).strip()
    # 「保存する」→「保存されます」のように形が変わっても拾えるよう、漢字・カタカナ・英数字の語で比べる
    words = [w for w in re.findall(r'[一-龥ァ-ヶーA-Za-z0-9]{2,}', core) if not re.fullmatch(FILLER, w)]
    if not words or not all(w in body for w in words):
        return False
    rest = body
    for w in words:
        rest = rest.replace(w, '')
    return len(re.sub(FILLER, '', rest)) <= 3


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
            body = re.sub(r'。?例[：:）)].*$', '', plain).rstrip('。 　')  # 末尾の「例：〇〇」は名詞で終わってよい
            for pat, msg in BAD_END:
                if re.search(pat, body):
                    out.append((loc, msg, text))
                    break
        if kind in LIMIT and len(text) > LIMIT[kind]:
            out.append((loc, f'{len(text)}字。目安 {LIMIT[kind]}字を超えている（はみ出しに注意）', text))
        if kind == 'say' and len(text) > 40:
            out.append((loc, f'{len(text)}字。字幕が2行を超えるかもしれない', text))

    slides = deck.get('slides', [])
    content = [sl for sl in slides if sl.get('type') not in ('cover', 'section')]
    prev_form, run = None, 0
    for i, sl in enumerate(slides, 1):
        t = sl.get('type')
        where = f'スライド{i}（{t}）'
        # 画面スライドに「この編集機能があるページ」が無い
        if t == 'shot' and not sl.get('where') and not sl.get('noWhere'):
            out.append((where, '`where` が無い。入力した内容がサイトに表示される画面なら書く。表示に関係しない画面（ログイン・メニュー・ダッシュボードなど）は "noWhere": true', sl.get('title', '')))
        # where に管理画面の場所を書いている
        if sl.get('where') and re.search(r'メニュー|右上|左上|左側|右側|管理画面|ダッシュボード', sl['where']):
            out.append((where, '`where` には管理画面の場所ではなく、サイトのページ名を書く（writing-guide.md の 7）', sl['where']))

        # 手順の絞り方（writing-guide.md の 5）
        st = sl.get('steps') or []
        if len(st) > 5:
            out.append((where, f'手順が{len(st)}つある。5つまでを目安に、任意の欄をまとめるか画面を分ける', sl.get('title', '')))
        opt = [s[0] for s in st if '任意' in s[0]]
        if len(opt) >= 2:
            out.append((where, '（任意）の欄に別々の番号を付けている。番号を外して1文にまとめる', '／'.join(opt)))
        for n, s in enumerate(st, 1):
            if len(s) > 1 and s[1] and body_is_echo(s[0], s[1]):
                out.append((f'{where} 手順{n}', '説明が見出しの言い換えだけかもしれない。足すことが無ければ空文字にする', f'{s[0]} ／ {s[1]}'))

        # note の使い分け（writing-guide.md の 6）
        nt = (sl.get('note') or {}).get('text', '')
        if nt:
            label = '注意' if sl['note'].get('kind') == 'warn' else 'ポイント'
            if re.search(r'https?://|URL[：:]', nt):
                out.append((f'{where} note', f'{label}に URL を書いている。URL などの情報は extra に書く', nt))
            elif re.search(NOTE_PROC, nt) and not re.search(NOTE_RISK, nt):
                out.append((f'{where} note', f'{label}が操作の手順になっている。手順なら steps に足す', nt))

        # タイトルの形が続いていないか（writing-guide.md の 7）
        title = sl.get('title', '')
        if title.endswith('。'):
            out.append((where, 'タイトルに句点「。」を付けない', title))
        form = next((name for pat, name in TITLE_FORMS if re.search(pat, title)), None) if t not in ('cover', 'section') else None
        run = run + 1 if form and form == prev_form else (1 if form else 0)
        prev_form = form
        if run == 3:
            out.append((where, f'{form}のタイトルが3枚続いている。やることから始める形に変える', title))

    # クライアントの指摘で決まったこと（SKILL.md「必ず入れるもの」）
    types = [sl.get('type') for sl in slides]
    if 'toc' not in types:
        out.append(('全体', '目次（toc）が無い。表紙の次に置く', ''))
    for i, sl in enumerate(slides, 1):
        if re.search(r'このマニュアルで(説明|扱う)', sl.get('title', '')):
            out.append((f'スライド{i}', '「このマニュアルで説明すること」ではなく目次（toc）にする', sl['title']))
    login = [sl for sl in slides if sl.get('type') == 'shot' and 'login' in str(sl.get('shot', '')).lower()]
    for sl in login:
        lines = ' '.join((sl.get('extra') or {}).get('lines', []))
        if not ('ユーザー名' in lines and 'パスワード' in lines):
            out.append(('ログインのスライド', 'extra に「ログイン情報」（URL・ユーザー名・パスワード）が無い。{{editor.user}} {{editor.pass}} で差し込む', sl.get('title', '')))
    if 'compare' not in types:
        out.append(('全体', 'compare（管理画面とサイトの対応）が無い。入力した内容がサイトのどこに出るかをサイトのスクリーンショットと並べて見せる', ''))
    for i, sl in enumerate(slides, 1):
        if sl.get('type') == 'compare':
            a, b = [len(x.get('marks') or []) for x in sl.get('shots', [{}, {}])[:2]]
            if not (a == b == len(sl.get('steps') or [])):
                out.append((f'スライド{i}（compare）', f'左の marks {a}個・右の marks {b}個・steps {len(sl.get("steps") or [])}個がそろっていない（サイトに出ない欄は右を null に）', sl.get('title', '')))

    # note の数（全体の3分の1が目安）
    with_note = [sl for sl in content if sl.get('note')]
    if content and len(with_note) > len(content) / 3 + 1:
        out.append(('全体', f'note が{len(content)}枚中{len(with_note)}枚にある。本当に必要なスライドだけに絞る（目安は3分の1以下）', ''))
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
