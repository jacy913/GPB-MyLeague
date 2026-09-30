import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AppView } from '../types';
import { Chevron, ChevronEdge } from '../components/ui';
import { NAV_FOLDERS, VIEW_TO_FOLDER, type FolderId } from './folders';

interface FolderNavProps {
  view: AppView;
  onSetView: (view: AppView) => void;
  className?: string;
  /**
   * Offset from the viewport top for the sticky case. Supplied by the shell,
   * which measures the sticky header rather than hardcoding its height, so the
   * nav cannot drift out of alignment when the header's contents change.
   */
  style?: React.CSSProperties;
}

type VisibleItem =
  | { id: `folder-${FolderId}`; kind: 'folder'; folderId: FolderId }
  | { id: `leaf-${AppView}`; kind: 'leaf'; folderId: FolderId; view: AppView };

/**
 * Desktop navigation rail for the seven-folder information architecture.
 *
 * This component intentionally owns no application state beyond folder expansion.
 * It can be mounted by the shell once ownership of App.tsx is available.
 */
export const FolderNav: React.FC<FolderNavProps> = ({ view, onSetView, className = '', style }) => {
  const activeFolder = VIEW_TO_FOLDER[view];
  const [expandedFolders, setExpandedFolders] = useState<Set<FolderId>>(() => new Set([activeFolder]));
  const [activeItemId, setActiveItemId] = useState<string>(`folder-${activeFolder}`);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    setExpandedFolders((current) => new Set([...current, activeFolder]));
  }, [activeFolder]);

  const visibleItems = useMemo<VisibleItem[]>(() => NAV_FOLDERS.flatMap((folder) => {
    const folderItem: VisibleItem = { id: `folder-${folder.id}`, kind: 'folder', folderId: folder.id };
    if (!expandedFolders.has(folder.id)) {
      return [folderItem];
    }
    return [
      folderItem,
      ...folder.leaves.map((leaf): VisibleItem => ({
        id: `leaf-${leaf.view}`,
        kind: 'leaf',
        folderId: folder.id,
        view: leaf.view,
      })),
    ];
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
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const expandFolder = (folderId: FolderId) => {
    setExpandedFolders((current) => current.has(folderId) ? current : new Set([...current, folderId]));
  };

  const moveFocus = (currentId: string, direction: -1 | 1) => {
    const index = visibleItems.findIndex((item) => item.id === currentId);
    const target = visibleItems[index + direction];
    if (target) {
      focusItem(target.id);
    }
  };

  const handleFolderKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, folderId: FolderId) => {
    const id = `folder-${folderId}`;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(id, 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(id, -1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        expandFolder(folderId);
        break;
      case 'ArrowLeft':
      case 'Escape':
        if (expandedFolders.has(folderId)) {
          event.preventDefault();
          toggleFolder(folderId);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        toggleFolder(folderId);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(visibleItems[0]?.id ?? id);
        break;
      case 'End':
        event.preventDefault();
        focusItem(visibleItems.at(-1)?.id ?? id);
        break;
    }
  };

  const handleLeafKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, item: Extract<VisibleItem, { kind: 'leaf' }>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(item.id, 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(item.id, -1);
        break;
      case 'ArrowLeft':
      case 'Escape':
        event.preventDefault();
        setExpandedFolders((current) => {
          const next = new Set(current);
          next.delete(item.folderId);
          return next;
        });
        focusItem(`folder-${item.folderId}`);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onSetView(item.view);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(visibleItems[0]?.id ?? item.id);
        break;
      case 'End':
        event.preventDefault();
        focusItem(visibleItems.at(-1)?.id ?? item.id);
        break;
    }
  };

  return (
    <aside
      aria-label="Primary navigation"
      // Height is derived from the measured header offset rather than the old
      // hardcoded 176px, which no longer described the header once the team strip
      // came out. Falls back to a sane value before the first measurement lands.
      style={{ height: 'calc(100vh - var(--sticky-header-h, 176px))', ...style }}
      className={`hidden w-60 shrink-0 overflow-y-auto border-r border-[var(--color-chrome-lo)] bg-[var(--color-base-2)] lg:block ${className}`}
    >
      <nav className="p-2" role="tree" aria-label="League navigation">
        {NAV_FOLDERS.map((folder) => {
          const FolderIcon = folder.icon;
          const isExpanded = expandedFolders.has(folder.id);
          const isActiveFolder = folder.id === activeFolder;
          const folderId = `folder-${folder.id}` as const;

          return (
            <div key={folder.id} className="mb-1">
              <button
                ref={(node) => {
                  if (node) itemRefs.current.set(folderId, node);
                  else itemRefs.current.delete(folderId);
                }}
                type="button"
                role="treeitem"
                aria-expanded={isExpanded}
                tabIndex={activeItemId === folderId ? 0 : -1}
                onFocus={() => setActiveItemId(folderId)}
                onClick={() => toggleFolder(folder.id)}
                onKeyDown={(event) => handleFolderKeyDown(event, folder.id)}
                className={`gold-sweep gold-edge flex h-11 w-full items-center gap-2 pl-4 pr-2 text-left t-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-void)] ${
                  isActiveFolder
                    ? 'border-l-[3px] border-l-[var(--color-gold)] text-[var(--color-gold)]'
                    : folder.accent === 'gold'
                      ? 'border-l-[3px] border-l-[var(--color-gold-lo)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]'
                      : 'border-l-[3px] border-l-transparent text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]'
                }`}
              >
                <FolderIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">{folder.label}</span>
                <ChevronEdge count={2} height={7} depth={6} className="opacity-60" />
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
                        ref={(node) => {
                          if (node) itemRefs.current.set(leafId, node);
                          else itemRefs.current.delete(leafId);
                        }}
                        type="button"
                        role="treeitem"
                        aria-current={isActiveLeaf ? 'page' : undefined}
                        tabIndex={activeItemId === leafId ? 0 : -1}
                        onFocus={() => setActiveItemId(leafId)}
                        onClick={() => onSetView(leaf.view)}
                        onKeyDown={(event) => handleLeafKeyDown(event, { id: leafId, kind: 'leaf', folderId: folder.id, view: leaf.view })}
                        className={`gold-sweep gold-edge flex h-9 w-full items-center gap-2 pl-4 pr-2 text-left t-caption focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-void)] ${
                          isActiveLeaf
                            ? 'border-l-[3px] border-l-[var(--color-gold)] bg-[var(--color-panel-3)] text-[var(--color-gold-hi)]'
                            : 'border-l-[3px] border-l-transparent text-[var(--color-ink)] hover:text-[var(--color-gold-hi)]'
                        }`}
                      >
                        {isActiveLeaf
                          ? <Chevron depth={7} height={8} className="text-[var(--color-gold)]" />
                          : <LeafIcon className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)]" aria-hidden="true" />}
                        <span>{leaf.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
};
