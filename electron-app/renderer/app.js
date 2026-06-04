// renderer/app.js - UI logic for the Electron app

// Elements
const selectFolderBtn = document.getElementById('selectFolderBtn');
const folderPathDiv = document.getElementById('folderPath');
const queueDiv = document.getElementById('queue');
const logDiv = document.getElementById('log');

// Helper to append log messages with timestamp
function log(message) {
  const time = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  line.textContent = `[${time}] ${message}`;
  logDiv.appendChild(line);
  logDiv.scrollTop = logDiv.scrollHeight;
}

// Helper to add a queue item UI element
function addQueueItem(fileName) {
  const item = document.createElement('div');
  item.className = 'queue-item';
  item.dataset.file = fileName;
  item.textContent = `${fileName} – ⏳`;
  queueDiv.appendChild(item);
  return item;
}

// Update status of a queue item
function updateQueueItem(fileName, status, extra = '') {
  const items = queueDiv.getElementsByClassName('queue-item');
  for (const it of items) {
    if (it.dataset.file === fileName) {
      it.textContent = `${fileName} – ${status}${extra ? ' – ' + extra : ''}`;
      if (status === '✅ Done') {
        it.classList.add('done');
      } else if (status === '❌ Error') {
        it.classList.add('error');
      }
      break;
    }
  }
}

// Folder selection handler
selectFolderBtn.addEventListener('click', async () => {
  try {
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
      folderPathDiv.textContent = `Folder: ${folder}`;
      // Clear previous UI
      queueDiv.innerHTML = '';
      log(`Selected folder: ${folder}`);
      // Start upload process
      const results = await window.electronAPI.startUpload(folder);
      log('Upload session finished');
      console.log('Results', results);
    } else {
      log('Folder selection cancelled');
    }
  } catch (e) {
    log(`Error selecting folder: ${e.message}`);
  }
});

// Receive progress updates from main process
window.electronAPI.onProgress((data) => {
  const { file, status, url, error } = data;
  if (status === 'uploading') {
    const item = addQueueItem(file);
    log(`Uploading ${file}...`);
  } else if (status === 'done') {
    updateQueueItem(file, '✅ Done', url ? `URL: ${url}` : '');
    log(`Uploaded ${file} – ${url || 'no URL'}`);
  } else if (status === 'error') {
    updateQueueItem(file, '❌ Error', error);
    log(`Failed ${file}: ${error}`);
  }
});
