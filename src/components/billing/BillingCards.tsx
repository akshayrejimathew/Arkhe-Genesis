'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Zap, Crown, Sparkles, type LucideIcon } from 'lucide-react';

type EngineTier = 'local' | 'sovereign' | 'enterprise';

interface EngineCard {
  id: EngineTier;
  name: string;
  tagline: string;
  price: string;
  features: string[];
  highlighted?: boolean;
  icon: LucideIcon;
  gradient: string;
}

interface BillingCardsProps {
  currentTier: EngineTier;
  onSelectTier: (tier: EngineTier) => void;
}

/**
 * COMPUTE ENGINE SELECTION – Sovereign Pivot
 * Replaces the billing UI with a choice of deployment environments.
 */
export default function BillingCards({ currentTier, onSelectTier }: BillingCardsProps) {
  const [hoveredTier, setHoveredTier] = useState<EngineTier | null>(null);

  const engines: EngineCard[] = [
    {
      id: 'local',
      name: 'Local Arkhé',
      tagline: 'Edge‑only execution',
      price: 'Edge‑Only',
      icon: Sparkles,
      gradient: 'from-zinc-600 to-zinc-800',
      features: [
        'Local Browser Engine',
        'Privacy‑First Persistence',
        'Standard Worker Throughput',
      ],
    },
    {
      id: 'sovereign',
      name: 'Sovereign Shield',
      tagline: 'Your infrastructure',
      price: 'Custom Vault',
      icon: Zap,
      gradient: 'from-cyan-500 via-blue-500 to-purple-600',
      highlighted: true,
      features: [
        'Your Personal Supabase',
        'Encrypted Cloud Sync',
        'Remote Forensic Snapshots',
      ],
    },
    {
      id: 'enterprise',
      name: 'Enterprise Genesis',
      tagline: 'Cluster‑grade scale',
      price: 'Cluster Grade',
      icon: Crown,
      gradient: 'from-amber-500 via-rose-500 to-purple-600',
      features: [
        'Shared Array Buffers',
        'Multi‑Genome Comparisons',
        'Dedicated Node‑Gossip Engine',
      ],
    },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {engines.map((engine) => {
        const Icon = engine.icon;
        const isActive = currentTier === engine.id;
        const isHovered = hoveredTier === engine.id;
        const isSovereign = engine.id === 'sovereign';

        return (
          <motion.div
            key={engine.id}
            className="relative"
            onHoverStart={() => setHoveredTier(engine.id)}
            onHoverEnd={() => setHoveredTier(null)}
            whileHover={{ y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {/* Liquid Border for Sovereign (formerly Demiurge) */}
            {isSovereign && (
              <motion.div
                className="absolute inset-0 rounded-xl overflow-hidden"
                style={{
                  background: `linear-gradient(${
                    isHovered ? '135deg' : '0deg'
                  }, #06b6d4, #3b82f6, #8b5cf6, #06b6d4)`,
                  backgroundSize: '400% 400%',
                  padding: '2px',
                }}
                animate={{
                  backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: "linear"
                }}
              >
                <div className="w-full h-full bg-void rounded-xl" />
              </motion.div>
            )}

            {/* Card */}
            <div
              className={`
                relative h-full flex flex-col rounded-xl overflow-hidden
                ${isSovereign ? '' : 'border border-razor'}
                ${isActive ? 'ring-2 ring-cyan-500/50' : ''}
                backdrop-blur-xl
              `}
              style={{
                background: isSovereign
                  ? 'linear-gradient(135deg, rgba(9, 9, 11, 0.95), rgba(24, 24, 27, 0.95))'
                  : 'rgba(24, 24, 27, 0.8)',
              }}
            >
              {/* Glow overlay */}
              {isHovered && (
                <motion.div
                  className="absolute inset-0 opacity-20 pointer-events-none"
                  animate={{
                    background: [
                      `radial-gradient(circle at 0% 0%, ${engine.gradient.split(' ')[0].replace('from-', '')} 0%, transparent 50%)`,
                      `radial-gradient(circle at 100% 100%, ${engine.gradient.split(' ')[2] || engine.gradient.split(' ')[1]?.replace('to-', '')} 0%, transparent 50%)`,
                      `radial-gradient(circle at 0% 0%, ${engine.gradient.split(' ')[0].replace('from-', '')} 0%, transparent 50%)`,
                    ],
                  }}
                  transition={{
                    duration: 4,
                    repeat: Infinity,
                  }}
                />
              )}

              {/* Content */}
              <div className="relative p-6 flex-1 flex flex-col">
                {/* Recommended Badge (now for Sovereign) */}
                {engine.highlighted && (
                  <div className="absolute top-4 right-4">
                    <div className="px-3 py-1 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full text-[9px] font-black uppercase tracking-wider text-white shadow-glow-cyan">
                      Recommended
                    </div>
                  </div>
                )}

                {/* Icon */}
                <div className="mb-4">
                  <div 
                    className={`inline-flex p-3 rounded-lg bg-gradient-to-br ${engine.gradient}`}
                    style={{
                      boxShadow: isHovered ? '0 0 30px currentColor' : '0 0 15px currentColor',
                      transition: 'box-shadow 0.3s'
                    }}
                  >
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                </div>

                {/* Header */}
                <div className="mb-6">
                  <h3 className="text-2xl font-black uppercase tracking-wider text-white mb-1">
                    {engine.name}
                  </h3>
                  <p className="text-xs text-zinc-500 italic">{engine.tagline}</p>
                </div>

                {/* Price (now deployment type) */}
                <div className="mb-6">
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-black text-white">{engine.price}</span>
                  </div>
                </div>

                {/* Features */}
                <ul className="space-y-3 mb-8 flex-1">
                  {engine.features.map((feature, index) => (
                    <motion.li
                      key={index}
                      className="flex items-start gap-2 text-sm"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <Check className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <span className="text-zinc-300">{feature}</span>
                    </motion.li>
                  ))}
                </ul>

                {/* Select Button */}
                <button
                  onClick={() => onSelectTier(engine.id)}
                  className={`
                    w-full py-3 px-4 rounded-lg font-bold text-sm uppercase tracking-wider
                    transition-all
                    ${isActive
                      ? 'bg-zinc-800 text-zinc-500 cursor-default'
                      : isSovereign
                      ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:shadow-glow-cyan'
                      : 'bg-void-surface border border-razor text-zinc-300 hover:bg-void-elevated hover:border-subtle'
                    }
                  `}
                  disabled={isActive}
                >
                  {isActive ? 'Current Environment' : 'Select'}
                </button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}