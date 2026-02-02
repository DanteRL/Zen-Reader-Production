import React, { useRef, useState } from 'react';
import { Upload, BookOpen, FileText } from 'lucide-react';

interface UploadViewProps {
  onFileLoaded: (title: string, content: string) => void;
}

export const UploadView: React.FC<UploadViewProps> = ({ onFileLoaded }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFile = async (file: File) => {
    if (file.type !== 'text/plain' && !file.name.endsWith('.txt')) {
      setError('Please upload a valid .txt file.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const buffer = await file.arrayBuffer();
      let content = '';
      
      try {
        // Try UTF-8 first
        const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
        content = utf8Decoder.decode(buffer);
      } catch (e) {
        // Fallback to GBK for Chinese files
        const gbkDecoder = new TextDecoder('gbk');
        content = gbkDecoder.decode(buffer);
      }

      // Basic cleanup of windows line endings
      const cleanContent = content.replace(/\r\n/g, '\n');
      onFileLoaded(file.name.replace('.txt', ''), cleanContent);
      setLoading(false);
    } catch (err) {
      console.error("Error reading file", err);
      setError('Error reading file');
      setLoading(false);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6">
      <div className="max-w-xl w-full text-center space-y-8">
        <div className="space-y-2">
          <div className="mx-auto w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200 mb-6">
            <BookOpen className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight font-sans">ZenReader</h1>
          <p className="text-gray-500 text-lg">Your distraction-free reading sanctuary.</p>
        </div>

        <div
          className={`
            relative group cursor-pointer
            border-2 border-dashed rounded-3xl p-12 transition-all duration-300
            ${isDragging ? 'border-blue-500 bg-blue-50 scale-[1.02]' : 'border-gray-300 hover:border-gray-400 bg-white'}
            ${error ? 'border-red-300 bg-red-50' : ''}
          `}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".txt"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />

          <div className="flex flex-col items-center gap-4">
            <div className={`p-4 rounded-full transition-colors ${isDragging ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400 group-hover:bg-gray-200 group-hover:text-gray-600'}`}>
              {loading ? (
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-current"></div>
              ) : (
                <Upload className="w-8 h-8" />
              )}
            </div>
            
            <div className="space-y-1">
              <p className="text-lg font-medium text-gray-700">
                {loading ? 'Reading file...' : 'Drop your .txt file here'}
              </p>
              <p className="text-sm text-gray-400">or click to browse</p>
            </div>
          </div>
          
          {error && (
            <div className="absolute inset-x-0 bottom-4 text-red-500 text-sm font-medium">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-center gap-6 text-sm text-gray-400">
           <div className="flex items-center gap-2">
             <FileText className="w-4 h-4" />
             <span>Local processing only</span>
           </div>
           <div className="flex items-center gap-2">
             <BookOpen className="w-4 h-4" />
             <span>Instant rendering</span>
           </div>
        </div>
      </div>
    </div>
  );
};
