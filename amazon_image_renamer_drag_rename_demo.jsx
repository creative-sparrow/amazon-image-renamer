import ReactDOM from "react-dom";
import React, { useRef, useState, useEffect } from "react";
import JSZip from "jszip";
import saveAs from "file-saver";

// ---------------- Utility helpers ----------------
// Robust download helper (FileSaver fallback if unavailable)
function triggerDownload(blobOrFile, filename) {
  try {
    if (typeof saveAs === "function") {
      saveAs(blobOrFile, filename);
      return true;
    }
  } catch (_) {}
  try {
    const url = URL.createObjectURL(blobOrFile);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error("Error saving file:", err);
  }
  return false;
}

// Read image file as ArrayBuffer
async function readImageAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
}

// Convert filename like "something._SX300_.jpg" to more readable "something.jpg"
function removeAmazonFileSizeSuffix(filename) {
  const regex = /\._SX\d+_\.([^.]*)$/;
  return filename.replace(regex, "." + RegExp.$1);
}

// Debounce utility to prevent frequent operations
function debounce(func, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => func.apply(this, args), delay);
  };
}

// Determine event offset relative to element
function getEventOffset(e) {
  const rect = e.target.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  return { x, y };
}

// Deduplicate image names by adding suffix if duplicates
function dedupeName(name, namesMap) {
  let baseName = name;
  let ext = "";
  const lastDot = name.lastIndexOf(".");
  if (lastDot !== -1) {
    baseName = name.substring(0, lastDot);
    ext = name.substring(lastDot);
  }
  let suffix = 1;
  let candidate = name;
  while (namesMap[candidate]) {
    candidate = `${baseName}-${suffix}${ext}`;
    suffix++;
  }
  namesMap[candidate] = true;
  return candidate;
}

// ---------------- React Components ----------------
function ImageItem({ file, index, moveImage, updateName, removeImage }) {
  const ref = useRef(null);

  // Drag-and-drop handling
  const handleDragStart = (e) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
    moveImage(fromIndex, index);
  };

  const handleNameChange = (e) => {
    updateName(index, e.target.value);
  };

  const handleRemove = () => {
    removeImage(index);
  };

  return (
    <div className="image-item" draggable onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} ref={ref}>
      <img src={URL.createObjectURL(file)} alt={`image-${index}`} />
      <input type="text" value={file.newName || file.name} onChange={handleNameChange} />
      <button onClick={handleRemove}>Remove</button>
    </div>
  );
}

function App() {
  const [files, setFiles] = useState([]);
  const inputRef = useRef();

  // Synchronize new names with existing names
  const syncNewNames = debounce(() => {
    setFiles((currentFiles) => {
      const namesMap = {};
      return currentFiles.map((file) => {
        const newName = dedupeName(file.newName || removeAmazonFileSizeSuffix(file.name), namesMap);
        return { ...file, newName };
      });
    });
  }, 300);

  useEffect(() => {
    syncNewNames();
  }, [files.map((f) => f.newName).join("")]);

  const handleFilesChange = (selectedFiles) => {
    const fileArray = Array.from(selectedFiles).map((file) => ({ file, name: file.name, newName: file.name }));
    setFiles((prev) => [...prev, ...fileArray]);
  };

  const handleInputChange = (e) => {
    handleFilesChange(e.target.files);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const droppedFiles = e.dataTransfer.files;
    handleFilesChange(droppedFiles);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const moveImage = (fromIndex, toIndex) => {
    setFiles((prevFiles) => {
      const updated = [...prevFiles];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
  };

  const updateName = (index, newName) => {
    setFiles((prevFiles) => {
      const updated = [...prevFiles];
      updated[index].newName = newName;
      return updated;
    });
  };

  const removeImage = (index) => {
    setFiles((prevFiles) => prevFiles.filter((_, i) => i !== index));
  };

  const handleDownload = async () => {
    const zip = new JSZip();
    for (const file of files) {
      const buffer = await readImageAsArrayBuffer(file.file);
      zip.file(file.newName || file.name, buffer);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    triggerDownload(blob, "images.zip");
  };

  return (
    <div className="container">
      <div
        className="drop-area"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => inputRef.current.click()}
      >
        Drag & Drop or Click to Upload
      </div>
      <input
        type="file"
        multiple
        accept="image/*"
        ref={inputRef}
        style={{ display: "none" }}
        onChange={handleInputChange}
      />
      <div className="image-list">
        {files.map((file, index) => (
          <ImageItem
            key={index}
            file={file.file}
            index={index}
            moveImage={moveImage}
            updateName={updateName}
            removeImage={removeImage}
          />
        ))}
      </div>
      <button onClick={handleDownload}>Download ZIP</button>
    </div>
  );
}

export default App;

// Mount App to root
const root = document.getElementById('root');
if (root) {
  ReactDOM.render(<App />, root);
}
