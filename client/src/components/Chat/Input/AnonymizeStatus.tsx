import { memo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, ShieldX, ShieldAlert, AlertCircle } from 'lucide-react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { Spinner } from '@librechat/client';
import store, { type ProtectionPhase } from '~/store/misc';

const pillVariants = {
  hidden: { opacity: 0, scale: 0.85, y: 4 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.85, y: -4 },
};

const PHASE_CONFIG: Record<
  Exclude<ProtectionPhase, 'idle' | 'streaming'>,
  { bg: string; text: string; icon: React.ReactNode; label: string }
> = {
  anonymizing: {
    bg: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    text: 'Anonimizando…',
    icon: <Spinner size={12} color="currentColor" />,
    label: 'anonymizing',
  },
  protected: {
    bg: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
    text: 'Protegido',
    icon: <ShieldCheck size={12} />,
    label: 'protected',
  },
  blocked: {
    bg: 'bg-red-500/15 text-red-700 dark:text-red-400',
    text: 'Bloqueado',
    icon: <ShieldX size={12} />,
    label: 'blocked',
  },
  degraded: {
    bg: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    text: 'Aviso',
    icon: <ShieldAlert size={12} />,
    label: 'degraded',
  },
  failed: {
    bg: 'bg-red-500/15 text-red-700 dark:text-red-400',
    text: 'Erro',
    icon: <AlertCircle size={12} />,
    label: 'failed',
  },
};

const AnonymizeStatus = memo(() => {
  const phase = useRecoilValue(store.protectionPhase);
  const setPhase = useSetRecoilState(store.protectionPhase);

  // Auto-advance protected → streaming after 1.5s
  useEffect(() => {
    if (phase !== 'protected') {
      return;
    }
    const timer = setTimeout(() => setPhase('streaming'), 1500);
    return () => clearTimeout(timer);
  }, [phase, setPhase]);

  const isVisible = phase !== 'idle';
  const config = phase !== 'idle' && phase !== 'streaming' ? PHASE_CONFIG[phase] : null;

  return (
    <AnimatePresence mode="wait">
      {isVisible && (
        <motion.div
          key={phase}
          variants={pillVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={{ duration: 0.18, ease: 'easeOut' }}
          aria-live="polite"
          aria-label={config?.label ?? phase}
        >
          {phase === 'streaming' ? (
            // Streaming: just a subtle dot
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          ) : config ? (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium max-sm:px-1.5 max-sm:text-[10px] ${config.bg}`}
            >
              {config.icon}
              {config.text}
            </span>
          ) : null}
        </motion.div>
      )}
    </AnimatePresence>
  );
});

AnonymizeStatus.displayName = 'AnonymizeStatus';

export default AnonymizeStatus;
