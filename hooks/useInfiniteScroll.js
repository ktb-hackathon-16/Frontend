import { useRef, useEffect } from 'react';

/**
 * IntersectionObserver 기반 무한 스크롤 훅
 * 
 * @param {Function} onLoadMore - 더 로드할 때 호출할 함수
 * @param {boolean} hasMore - 더 불러올 데이터가 있는지 여부
 * @param {boolean} isLoading - 현재 로딩 중인지 여부
 * @param {Object} options - IntersectionObserver 옵션
 * @returns {Object} { sentinelRef } - Sentinel 요소에 연결할 ref
 */
export const useInfiniteScroll = (
  onLoadMore,
  hasMore = true,
  isLoading = false,
  options = {}
) => {
  const sentinelRef = useRef(null);
  const {
    enabled = true,
    rootRef = null,
    rootMargin = '0px',
    threshold = 0.1,
  } = options;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (
      !sentinel ||
      !hasMore ||
      !enabled
    ) {
      return;
    }

    const observerOptions = {
      root: rootRef?.current ?? null,
      rootMargin,
      threshold,
    };

    const handleIntersect = (entries) => {
      const [entry] = entries;

      if (
        enabled &&
        entry.isIntersecting &&
        hasMore &&
        !isLoading
      ) {
        onLoadMore();
      }
    };

    const observer = new IntersectionObserver(
      handleIntersect,
      observerOptions
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [
    enabled,
    hasMore,
    isLoading,
    onLoadMore,
    rootRef,
    rootMargin,
    threshold,
  ]);

  return { sentinelRef };
};

export default useInfiniteScroll;
