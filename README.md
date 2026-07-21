# Band Roach

給樂手快速把級數轉成和弦的行動小工具，支援換調、Capo、吉他指法、和弦播放，以及拍照辨識級數譜。

- [開啟 Band Roach](https://band-roach.yixiulin24.chatgpt.site)
- [HTML 操作指南](docs/user-guide.html)

## 本機開發

需求：Node.js 22.13 以上。

```bash
npm install
npm run dev
```

## 發布前檢查

```bash
npm test
npm run build
```

測試會守住基本大小調、延伸和弦、升降級數、Slash Chord、Capo 換算與人工驗證指法。

## 資料與隱私

拍照轉譜的圖片、框選與修正紀錄保存在使用者自己的瀏覽器裝置中，不會上傳到應用程式伺服器。使用者可在轉譜區按「清除目前樂譜」刪除本機紀錄。
