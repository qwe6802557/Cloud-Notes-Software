import React, { useEffect, useRef, useState } from 'react';
import { computeRemainingSeconds, formatCountdownMMSS } from '@/utils/quickMemoHelper';

/**
 * 独立秒级倒计时徽标，隔离每秒重绘范围并在到期时触发单次回调
 */
export default function CountdownBadge({ expireAt, clockOffsetMs = 0, onExpired }) {
    const [remaining, setRemaining] = useState(() =>
        computeRemainingSeconds(expireAt, clockOffsetMs)
    );
    const expiredFiredRef = useRef(false);
    const onExpiredRef = useRef(onExpired);
    onExpiredRef.current = onExpired;

    useEffect(() => {
        expiredFiredRef.current = false;
        const initial = computeRemainingSeconds(expireAt, clockOffsetMs);
        setRemaining(initial);
        if (initial === null) return undefined;

        if (initial <= 0) {
            expiredFiredRef.current = true;
            onExpiredRef.current?.();
            return undefined;
        }

        const timer = setInterval(() => {
            const next = computeRemainingSeconds(expireAt, clockOffsetMs);
            setRemaining(next);
            if (next !== null && next <= 0 && !expiredFiredRef.current) {
                expiredFiredRef.current = true;
                clearInterval(timer);
                onExpiredRef.current?.();
            }
        }, 1000);

        return () => clearInterval(timer);
    }, [expireAt, clockOffsetMs]);

    if (remaining === null) return null;
    const isUrgent = remaining <= 60;

    return (
        <span className={`countdown-badge ${isUrgent ? 'is-urgent' : ''}`}>
            <span className="pulse-dot" />
            剩余 {formatCountdownMMSS(remaining)}
        </span>
    );
}
