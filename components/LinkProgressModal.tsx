
import React, { useState } from 'react';
import { X, Link2, BookOpen, Clock, Search } from 'lucide-react';
import { CloudProgress } from '../cloudSync';
import { translations, Locale } from '../locales';
import { calculateProgress } from '../utils';

interface LinkProgressModalProps {
  bookTitle: string;
  progressList: CloudProgress[];
  onLink: (targetHash: string) => void;
  onClose: () => void;
  language: Locale;
}

export const LinkProgressModal: React.FC<LinkProgressModalProps> = ({
  bookTitle,
  progressList,
  onLink,
  onClose,
  language
}) => {
  const t = translations[language];
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedHash, setSelectedHash] = useState<string | null>(null);

  const filteredList = progressList.filter(p =>
    p.book_title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.author || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (timestamp: number) => {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    return d.toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg relative z-10 animate-in fade-in zoom-in-95 duration-200 overflow-hidden flex flex-col max-h-[80vh]">
        
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Link2 className="w-5 h-5 text-blue-600" />
                {t.link_title}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {t.link_subtitle} <span className="font-medium text-gray-700">"{bookTitle}"</span>
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Search */}
          <div className="mt-4 flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
            <Search className="w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder={t.link_search_placeholder}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none text-gray-800 placeholder-gray-400"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredList.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <BookOpen className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm">{t.link_empty}</p>
            </div>
          ) : (
            filteredList.map((item) => {
              const progress = calculateProgress(item.current_page_index, item.total_pages);
              const isSelected = selectedHash === item.file_hash;
              
              return (
                <button
                  key={item.file_hash}
                  onClick={() => setSelectedHash(isSelected ? null : item.file_hash)}
                  className={`
                    w-full text-left px-4 py-3 rounded-xl border transition-all duration-150
                    ${isSelected
                      ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-100'
                      : 'border-gray-100 bg-white hover:bg-gray-50 hover:border-gray-200'
                    }
                  `}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className={`text-sm font-medium truncate ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                        {item.book_title}
                      </h3>
                      {item.author && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">{item.author}</p>
                      )}
                    </div>
                    <div className="text-right ml-4 shrink-0">
                      <div className={`text-sm font-bold ${isSelected ? 'text-blue-600' : 'text-gray-700'}`}>
                        {progress}%
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-gray-400">
                        <Clock className="w-3 h-3" />
                        {formatDate(item.last_read_at)}
                      </div>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all ${isSelected ? 'bg-blue-500' : 'bg-gray-300'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-medium text-sm hover:bg-gray-50 transition-colors"
          >
            {t.cancel}
          </button>
          <button
            onClick={() => selectedHash && onLink(selectedHash)}
            disabled={!selectedHash}
            className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Link2 className="w-4 h-4" />
            {t.link_confirm}
          </button>
        </div>
      </div>
    </div>
  );
};
