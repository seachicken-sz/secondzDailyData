# ドリパスのチケット確認

毎日18:05以降（日本時間）に、ランキング取得と別のActionsをGASから起動します。
既存の `title_list` の title とイベント詳細の「上映情報」の作品名を、
NFKC・空白除去・小文字化で整えて完全一致照合します。作品URLでは照合しません。
URL、順位、作品状態は変更しません。1作品複数イベントを保存できます。

## GitHub

追加ファイル：
- scripts/capture-dreampass-tickets.js
- .github/workflows/capture-dreampass-tickets.yml

既存のDREAMPASS_WEB_APP_URLとDREAMPASS_SYNC_TOKENを使います。
package.jsonは変更不要です。

## GAS：変更するのはドリパス取得用GAS

タムごとJSON送信用GASではなく、title_listを持つスプシに紐づく、
既存のdpSheet_、dpJson_、doPostがあるプロジェクトで作業します。

1. 同じプロジェクト内に `dreampass-tickets.gs` を作り、
   このリポジトリの `gas/dreampass-tickets.gs` の内容を全文貼り付けます。
2. 既存の `doPost(e)` 内の `lock.waitLock(30000);` のすぐ後、
   `const sheet = dpSheet_();` より前に、以下の分岐を追加します。
   既存のtoken認証とlock取得の後に置いてください。

```javascript
    if (body.action === "ticketTargets" || body.action === "ticketUpdate") {
      return dpTicketHandle_(body);
    }
```

3. 「デプロイを管理 → 編集 → 新バージョン」で既存のウェブアプリを更新します。
   URLは変更しません。
4. `runDreampassTicketCapture` を一度手動実行して権限を許可します。
   この関数は時刻に関係なく起動します。GitHubで「Capture Dreampass Tickets」が成功し、
   同じスプシに `ticket_list` が作成されることを確認します。
5. `setupDreampassTicketTrigger` を1回だけ手動実行します。
   5分間隔の時間トリガーが作られ、18:05以降にその日1回だけActionsを起動します。
   この専用トリガー以外は変更しません。

スクリプトプロパティの追加は不要です。
- GITHUB_TOKEN：既存の結果送受信用の合言葉
- GITHUB_ACTIONS_TOKEN：既存のGitHub Actions起動用アクセストークン

## ticket_list

title / member / event_id / event_title / URL / theater / start_at /
sale_status / screening_status / captured_at

販売中・販売前・完売・販売終了を別々に記録します。
HTMLで判定できない販売状態は「要確認」です。
同じイベントに対象作品が複数ある場合は作品ごとに行を持ちます。

一覧本体だけを辿り、サイドバー・コメント・過去のチケット一覧は検索しません。
一覧にページ送りがある場合も巡回します（最大20ページ）。
全イベント詳細を正常に確認した場合だけ置き換えます。
正常取得で一致0件ならヘッダーだけに更新します。
一覧の構造変更や途中の取得失敗時は、前回データを保持してActionsを失敗にします。
巡回中にtitle_listが変更された場合、古い結果では上書きせず再実行を求めます。
取得元一覧の構造や販売状態の表示が変わった場合は、抽出処理の調整が必要です。

別表記を指定したい場合のみ、title_listに任意の `match_titles` 列を追加できます。
別名は改行または `|` 区切りで指定します。部分一致はしません。

## 実行時刻と再試行

GASの5分トリガーとActionsの待機により、取得開始は18:05ちょうどではありません。
起動要求自体の失敗は、次の5分間隔で再試行します。
Actions起動後の巡回失敗は自動再起動しません。
修正後にrunDreampassTicketCaptureを手動実行してください。
正常な取得結果のスプシ反映までが今回の範囲です。
タムごとへのJSON送信や通知は実行しません。

## 検証

JS/GAS構文、タイトル照合4項目、GAS保存ガード5項目を確認。実ブラウザ巡回は未実行。
実環境での初回確認には上記のGAS変更とウェブアプリの更新が必要です。
