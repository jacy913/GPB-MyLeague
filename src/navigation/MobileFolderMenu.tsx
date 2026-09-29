import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import type { AppView } from '../types';
import { NAV_FOLDERS, VIEW_TO_FOLDER, type FolderId } from './folders';

interface MobileFolderMenuProps {
  isOpen: boolean;
  view: AppView;
  onSetView: (view: AppView) => void;
  onClose: () => void;
}

type VisibleItem =
  | { id: `folder-${FolderId}`; kind: 'folder'; folderId: FolderId }
  | { id: `leaf-${AppView}`; kind: 'leaf'; folderId: FolderId; view: AppView };

/**
 * Full-height mobile navigation panel. The shell supplies the hamburger state;
 * this component owns expansion, focus movement, and modal lifecycle behavior.
 */
export const MobileFolderMenu: React.FC<MobileFolderMenuProps> = ({
  isOpen,
  view,
  onSetView,
  onClose,
}) => {
  const activeFolder = VIEW_TO_FOLDER[view];
  const [expandedFolders, setExpandedFolders] = useState<Set<FolderId>>(() => new Set([activeFolder]));
  const [activeItemId, setActiveItemId] = useState<string>(`folder-${activeFolder}`);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setExpandedFolders((current) => new Set([...current, activeFolder]));
  }, [activeFolder]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  const visibleItems = useMemo<VisibleItem[]>(() => NAV_FOLDERS.flatMap((folder) => {
    const folderItem: VisibleItem = { id: `folder-${folder.id}`, kind: 'folder', folderId: folder.id };
    return expandedFolders.has(folder.id)
      ? [folderItem, ...folder.leaves.map((leaf): VisibleItem => ({ id: `leaf-${leaf.view}`, kind: 'leaf', folderId: folder.id, view: leaf.view }))]
      : [folderItem];
  }), [expandedFolders]);

  useEffect(() => {
    if (!visibleItems.some((item) => item.id === activeItemId)) {
      setActiveItemId(`folder-${activeFolder}`);
    }
  }, [activeFolder, activeItemId, visibleItems]);

  const focusItem = (id: string) => {
    setActiveItemId(id);
    requestAnimationFrame(() => itemRefs.current.get(id)?.focus());
  };

  const toggleFolder = (folderId: FolderId) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const moveFocus = (currentId: string, direction: -1 | 1) => {
    const index = visibleItems.findIndex((item) => item.id === currentId);
    const target = visibleItems[index + direction];
    if (target) focusItem(target.id);
  };

  const handleFolderKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, folderId: FolderId) => {
    const id = `folder-${folderId}`;
    if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(id, 1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(id, -1); }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setExpandedFolders((current) => current.has(folderId) ? current : new Set([...current, folderId]));
    }
    if (event.key === 'ArrowLeft') { event.preventDefault(); setExpandedFolders((current) => new Set([...current].filter((id) => id !== folderId))); }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleFolder(folderId); }
    if (event.key === 'Home') { event.preventDefault(); focusItem(visibleItems[0]?.id ?? id); }
    if (event.key === 'End') { event.preventDefault(); focusItem(visibleItems.at(-1)?.id ?? id); }
  };

  const handleLeafKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, item: Extract<VisibleItem, { kind: 'leaf' }>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(item.id, 1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(item.id, -1); }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setExpandedFolders((current) => new Set([...current].filter((id) => id !== item.folderId)));
      focusItem(`folder-${item.folderId}`);
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSetView(item.view);
      onClose();
    }
    if (event.key === 'Home') { event.preventDefault(); focusItem(visibleItems[0]?.id ?? item.id); }
    if (event.key === 'End') { event.preventDefault(); focusItem(visibleItems.at(-1)?.id ?? item.id); }
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[color:color-mix(in_srgb,var(--color-void)_78%,transparent)] lg:hidden" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="League navigation"
        className="h-full w-full overflow-y-auto bg-[var(--color-base)] shadow-[var(--shadow-bev-lg)] sm:max-w-sm"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="chrome-bar sticky top-0 z-10 flex items-center justify-between px-4">
          <span className="t-h3">Navigation</span>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-void)]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <nav className="p-3" role="tree" aria-label="League navigation">
          {NAV_FOLDERS.map((folder) => {
            const FolderIcon = folder.icon;
            const isExpanded = expandedFolders.has(folder.id);
            const isActiveFolder = activeFolder === folder.id;
            const folderId = `folder-${folder.id}` as const;
            return (
              <div key={folder.id} className="mb-1">
                <button
                  ref={(node) => { if (node) itemRefs.current.set(folderId, node); else itemRefs.current.delete(folderId); }}
                  type="button"
                  role="treeitem"
                  aria-expanded={isExpanded}
                  tabIndex={activeItemId === folderId ? 0 : -1}
                  onFocus={() => setActiveItemId(folderId)}
                  onClick={() => toggleFolder(folder.id)}
                  onKeyDown={(event) => handleFolderKeyDown(event, folder.id)}
                  className={`flex h-10 w-full items-center gap-2 border-l-[3px] px-2 text-left t-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-void)] ${
                    isActiveFolder ? 'border-[var(--color-gold)] text-[var(--color-gold)]' : 'border-transparent text-[var(--color-ink-dim)]'
                  }`}
                >
                  <FolderIcon className="h-4 w-4" aria-hidden="true" />
                  <span className="flex-1">{folder.label}</span>
                  {isExpanded ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                </button>
                {isExpanded && (
                  <div role="group" aria-label={`${folder.label} destinations`} className="ml-4">
                    {folder.leaves.map((leaf) => {
                      const LeafIcon = leaf.icon;
                      const leafId = `leaf-${leaf.view}` as const;
                      const isActiveLeaf = view === leaf.view;
                      return (
                        <button
                          key={leaf.view}
                          ref={(node) => { if (node) itemRefs.current.set(leafId, node); else itemRefs.current.delete(leafId); }}
                          type="button"
                          role="treeitem"
                          aria-current={isActiveLeaf ? 'page' : undefined}
                          tabIndex={activeItemId === leafId ? 0 : -1}
                          onFocus={() => setActiveItemId(leafId)}
                          onClick={() => { onSetView(leaf.view); onClose(); }}
                          onKeyDown={(event) => handleLeafKeyDown(event, { id: leafId, kind: 'leaf', folderId: folder.id, view: leaf.view })}
                          className={`flex h-10 w-full items-center gap-2 border-l-[3px] px-2 text-left t-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-void)] ${
                            isActiveLeaf ? 'border-[var(--color-gold)] bg-[var(--color-panel-3)] text-[var(--color-gold-hi)]' : 'border-transparent text-[var(--color-ink)]'
                          }`}
                        >
                          {isActiveLeaf ? <span className="text-[var(--color-gold)]" aria-hidden="true">▶</span> : <LeafIcon className="h-4 w-4 text-[var(--color-ink-faint)]" aria-hidden="true" />}
                          <span>{leaf.mobileLabel ?? leaf.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </section>
    </div>
  );
};
