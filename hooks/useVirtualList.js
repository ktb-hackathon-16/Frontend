import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_ITEM_HEIGHT = 112;
const DEFAULT_OVERSCAN = 8;
const DEFAULT_INITIAL_VIEWPORT_ITEMS = 42;

const lowerBound = (offsets, value) => {
  let low = 0;
  let high = offsets.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (offsets[mid] < value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
};

export const useVirtualList = ({
  itemCount,
  containerRef,
  estimateSize = DEFAULT_ITEM_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
  initialViewportItems = DEFAULT_INITIAL_VIEWPORT_ITEMS,
  pinnedIndexes = [],
}) => {
  const sizeMapRef = useRef(new Map());
  const itemObserversRef = useRef(new Map());
  const [measureVersion, setMeasureVersion] = useState(0);
  const [viewport, setViewport] = useState({
    scrollTop: 0,
    height: estimateSize * initialViewportItems,
  });

  const offsets = useMemo(() => {
    const nextOffsets = new Array(itemCount + 1);
    nextOffsets[0] = 0;

    for (let index = 0; index < itemCount; index += 1) {
      nextOffsets[index + 1] = nextOffsets[index] + (sizeMapRef.current.get(index) || estimateSize);
    }

    return nextOffsets;
  }, [itemCount, estimateSize, measureVersion]);

  const totalSize = offsets[itemCount] || 0;

  const updateViewport = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;

    const nextViewport = {
      scrollTop: element.scrollTop,
      height: element.clientHeight || estimateSize * initialViewportItems,
    };

    setViewport(previous => (
      previous.scrollTop === nextViewport.scrollTop && previous.height === nextViewport.height
        ? previous
        : nextViewport
    ));
  }, [containerRef, estimateSize, initialViewportItems]);

  useLayoutEffect(() => {
    updateViewport();
  }, [itemCount, updateViewport]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    updateViewport();
    element.addEventListener('scroll', updateViewport, { passive: true });

    let containerObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      containerObserver = new ResizeObserver(updateViewport);
      containerObserver.observe(element);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', updateViewport);
    }

    return () => {
      element.removeEventListener('scroll', updateViewport);
      containerObserver?.disconnect();
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', updateViewport);
      }
    };
  }, [containerRef, updateViewport]);

  const range = useMemo(() => {
    if (itemCount === 0) {
      return { startIndex: 0, endIndex: 0 };
    }

    const rawStart = Math.max(0, lowerBound(offsets, viewport.scrollTop) - overscan);
    const rawEnd = lowerBound(offsets, viewport.scrollTop + viewport.height);
    const endIndex = Math.min(itemCount, rawEnd + overscan + 1);

    return {
      startIndex: rawStart,
      endIndex,
    };
  }, [itemCount, offsets, overscan, viewport.height, viewport.scrollTop]);

  const virtualItems = useMemo(() => {
    const indexes = new Set();

    for (let index = range.startIndex; index < range.endIndex; index += 1) {
      indexes.add(index);
    }

    for (const index of pinnedIndexes) {
      if (Number.isInteger(index) && index >= 0 && index < itemCount) {
        indexes.add(index);
      }
    }

    return [...indexes].sort((a, b) => a - b).map((index) => ({
      index,
      key: index,
      start: offsets[index],
      size: offsets[index + 1] - offsets[index],
    }));
  }, [itemCount, offsets, pinnedIndexes, range.endIndex, range.startIndex]);

  const measureElement = useCallback((index, node) => {
    itemObserversRef.current.get(index)?.disconnect();
    itemObserversRef.current.delete(index);

    if (!node) return;

    const applyMeasuredSize = (height) => {
      if (!height) return;

      const previous = sizeMapRef.current.get(index);
      if (Math.abs((previous || 0) - height) < 1) return;

      sizeMapRef.current.set(index, height);
      setMeasureVersion(version => version + 1);
    };

    applyMeasuredSize(node.getBoundingClientRect().height);

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(([entry]) => {
        applyMeasuredSize(entry.contentRect.height);
      });
      observer.observe(node);
      itemObserversRef.current.set(index, observer);
    }
  }, []);

  useEffect(() => () => {
    itemObserversRef.current.forEach(observer => observer.disconnect());
    itemObserversRef.current.clear();
  }, []);

  return {
    totalSize,
    virtualItems,
    measureElement,
  };
};

export default useVirtualList;
