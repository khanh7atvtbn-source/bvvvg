# YouTube Automation

Automation nay dung Playwright va profile Chrome da dang nhap san de upload video len YouTube Studio.

## Dang nhap profile

```powershell
npm run login-acc1
npm run login-acc2
npm run login-acc3
```

Dang nhap Google/YouTube trong cua so Chrome vua mo, sau do quay lai terminal bam Enter.

## Upload 1 video

Sua `data/video.json`, nhat la `filePath`, roi chay:

```powershell
npm run upload -- --account acc1
```

Co the override nhanh tu terminal:

```powershell
npm run upload -- --account acc1 --file "C:\Videos\demo.mp4" --title "Tieu de video" --privacy private
```

`privacy` nhan `private`, `unlisted`, hoac `public`. Mac dinh la `private`.

## Upload nhieu video

Them danh sach vao `data/queue.json`:

```json
[
  {
    "account": "acc1",
    "filePath": "C:/Videos/video-1.mp4",
    "title": "Video 1",
    "description": "Mo ta video 1",
    "privacy": "private",
    "madeForKids": false
  }
]
```

Chay:

```powershell
npm run multi-upload
```

Ket qua luu vao `data/uploaded.json`, log nam trong `logs/`.
