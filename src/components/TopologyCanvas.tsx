import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { NetNode, Topology } from '../core/types'
import { isUsable } from '../core/graph'

export type CanvasTool = 'select' | 'connect' | 'add-router' | 'add-host' | 'add-server' | 'delete'

export interface CanvasHighlight {
  nodes?: string[]
  links?: string[]
}

interface Props {
  topology: Topology
  selectedNodeId?: string | null
  selectedLinkId?: string | null
  highlight?: CanvasHighlight
  routePath?: string[]
  packetAt?: { x: number; y: number } | null
  sourceId?: string | null
  destId?: string | null
  pendingLinkFrom?: string | null
  tool?: CanvasTool
  interactive?: boolean
  onAddNodeAt?: (x: number, y: number) => void
  onNodeClick?: (id: string) => void
  onLinkClick?: (id: string) => void
  onMoveNode?: (id: string, x: number, y: number) => void
  onBackgroundClick?: () => void
}

const KIND_FILL: Record<NetNode['kind'], string> = {
  router: '#1d4ed8',
  host: '#155e75',
  server: '#4c1d95',
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 900, height: 520 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ width: el.clientWidth || 900, height: el.clientHeight || 520 })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, size }
}

export function TopologyCanvas({
  topology,
  selectedNodeId,
  selectedLinkId,
  highlight,
  routePath,
  packetAt,
  sourceId,
  destId,
  pendingLinkFrom,
  tool = 'select',
  interactive = true,
  onAddNodeAt,
  onNodeClick,
  onLinkClick,
  onMoveNode,
  onBackgroundClick,
}: Props) {
  const { ref, size } = useSize<HTMLDivElement>()
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [view, setView] = useState({ k: 1, x: 0, y: 0 })
  const drag = useRef<{ id: string; moved: boolean } | null>(null)
  const pan = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  const posById = useMemo(() => {
    const map: Record<string, NetNode> = {}
    for (const n of topology.nodes) map[n.id] = n
    return map
  }, [topology])

  const contentBox = useCallback(() => {
    if (topology.nodes.length === 0) return { x: 0, y: 0, w: 1, h: 1 }
    const xs = topology.nodes.map((n) => n.x)
    const ys = topology.nodes.map((n) => n.y)
    const minX = Math.min(...xs) - 70
    const maxX = Math.max(...xs) + 70
    const minY = Math.min(...ys) - 60
    const maxY = Math.max(...ys) + 60
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }, [topology])

  const fit = useCallback(() => {
    const box = contentBox()
    const k = Math.max(0.2, Math.min(size.width / box.w, size.height / box.h, 2))
    setView({ k, x: (size.width - box.w * k) / 2 - box.x * k, y: (size.height - box.h * k) / 2 - box.y * k })
  }, [contentBox, size.width, size.height])

  // Auto-fit when a different topology is loaded.
  const fittedFor = useRef<string>('')
  useEffect(() => {
    if (fittedFor.current !== topology.id || topology.nodes.length === 0) {
      if (fittedFor.current !== topology.id) {
        fittedFor.current = topology.id
        fit()
      }
    }
  }, [topology.id, topology.nodes.length, fit])

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k }
    },
    [view]
  )

  const onWheel = (e: React.WheelEvent) => {
    if (!interactive) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const k = Math.max(0.2, Math.min(3.2, view.k * factor))
    setView({ k, x: px - ((px - view.x) * k) / view.k, y: py - ((py - view.y) * k) / view.k })
  }

  const onPointerDownBg = (e: React.PointerEvent) => {
    if (!interactive) return
    if (tool.startsWith('add-')) {
      const w = toWorld(e.clientX, e.clientY)
      onAddNodeAt?.(Math.round(w.x), Math.round(w.y))
      return
    }
    pan.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!interactive) return
    if (drag.current) {
      const w = toWorld(e.clientX, e.clientY)
      drag.current.moved = true
      onMoveNode?.(drag.current.id, Math.round(w.x), Math.round(w.y))
      return
    }
    if (pan.current) {
      setView((v) => ({ ...v, x: pan.current!.ox + (e.clientX - pan.current!.sx), y: pan.current!.oy + (e.clientY - pan.current!.sy) }))
    }
  }

  const endDrag = () => {
    drag.current = null
    pan.current = null
  }

  const highlightLinks = new Set(highlight?.links ?? [])
  const highlightNodes = new Set(highlight?.nodes ?? [])
  const routeSet = new Set(routePath ?? [])

  const addKind = tool === 'add-router' ? 'router' : tool === 'add-host' ? 'host' : tool === 'add-server' ? 'server' : null

  return (
    <div className="canvas-frame" ref={ref} style={{ height: '100%', minHeight: 360 }}>
      <svg
        ref={svgRef}
        className={`graph${pan.current ? ' panning' : ''}`}
        onWheel={onWheel}
        onPointerDown={(e) => {
          if ((e.target as Element).getAttribute('data-role') === 'background') onPointerDownBg(e)
        }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <rect
          data-role="background"
          x={0}
          y={0}
          width={size.width}
          height={size.height}
          fill="transparent"
          onClick={() => (tool === 'select' ? onBackgroundClick?.() : undefined)}
        />
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {/* links */}
          {topology.links.map((l) => {
            const a = posById[l.a]
            const b = posById[l.b]
            if (!a || !b) return null
            const midX = (a.x + b.x) / 2
            const midY = (a.y + b.y) / 2
            const isHi = highlightLinks.has(l.id)
            const isSel = selectedLinkId === l.id
            const cls = `link-line${l.status === 'failed' ? ' failed' : ''}${l.status === 'congested' ? ' congested' : ''}`
            return (
              <g key={l.id}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onLinkClick?.(l.id)
                }}
              >
                <line data-role="link" className="link-hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                <line
                  className={cls}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={isHi || isSel ? '#22d3ee' : undefined}
                  strokeWidth={isHi || isSel ? 4 : undefined}
                  opacity={isUsable(l) ? 1 : 0.85}
                />
                <g transform={`translate(${midX},${midY})`}>
                  <rect x={-15} y={-11} width={30} height={16} rx={4} fill="var(--bg)" stroke={isSel ? '#22d3ee' : 'var(--border)'} strokeWidth={isSel ? 1.5 : 1} />
                  <text className="cost-label" textAnchor="middle" y={2}>
                    {l.cost}
                  </text>
                </g>
              </g>
            )
          })}

          {/* pending connect line follows not needed; highlight between source & cursor handled in parent */}

          {/* nodes */}
          {topology.nodes.map((n) => {
            const isRouter = n.kind === 'router'
            const selected = selectedNodeId === n.id
            const hi = highlightNodes.has(n.id) || routeSet.has(n.id)
            const isSrc = sourceId === n.id
            const isDst = destId === n.id
            const stroke = selected || isSrc ? '#22d3ee' : hi ? '#3b82f6' : isDst ? '#34d399' : 'var(--border)'
            const sw = selected || isSrc || isDst ? 3 : hi ? 2.5 : 1.5
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                className="node-shape"
                onPointerDown={(e) => {
                  if (!interactive) return
                  e.stopPropagation()
                  if (tool === 'select' || tool === 'connect' || tool === 'delete') drag.current = { id: n.id, moved: false }
                }}
                onPointerUp={(e) => {
                  if (!interactive) return
                  e.stopPropagation()
                  if (drag.current && !drag.current.moved) onNodeClick?.(n.id)
                  else if (!drag.current) onNodeClick?.(n.id)
                  drag.current = null
                }}
              >
                {isRouter ? (
                  <circle r={20} fill={KIND_FILL.router} stroke={stroke} strokeWidth={sw} />
                ) : (
                  <rect x={-19} y={-16} width={38} height={32} rx={7} fill={KIND_FILL[n.kind]} stroke={stroke} strokeWidth={sw} />
                )}
                <text className="node-label" textAnchor="middle" y={isRouter ? 4 : 3}>
                  {n.label.length > 6 ? `${n.label.slice(0, 5)}…` : n.label}
                </text>
                <text className="node-sub" textAnchor="middle" y={isRouter ? 34 : 30}>
                  {n.kind === 'router' ? (n.asNumber !== undefined ? `AS${n.asNumber}` : 'router') : n.ip ?? 'host'}
                </text>
                {isSrc ? <text className="node-sub" textAnchor="middle" y={-26} fill="#22d3ee">SRC</text> : null}
                {isDst ? <text className="node-sub" textAnchor="middle" y={-26} fill="#34d399">DST</text> : null}
              </g>
            )
          })}

          {pendingLinkFrom && posById[pendingLinkFrom] ? (
            <circle cx={posById[pendingLinkFrom]!.x} cy={posById[pendingLinkFrom]!.y} r={26} fill="none" stroke="#22d3ee" strokeWidth={1.5} strokeDasharray="4 4" />
          ) : null}

          {packetAt ? <circle className="packet-marker" cx={packetAt.x} cy={packetAt.y} r={7} /> : null}
        </g>
      </svg>

      {interactive ? (
        <div className="canvas-toolbar">
          <button className="btn sm ghost" title="Zoom out" onClick={() => setView((v) => ({ ...v, k: Math.max(0.2, v.k / 1.2), x: size.width / 2 - ((size.width / 2 - v.x) * (v.k / 1.2)) / v.k, y: size.height / 2 - ((size.height / 2 - v.y) * (v.k / 1.2)) / v.k }))}>−</button>
          <button className="btn sm ghost" title="Zoom in" onClick={() => setView((v) => ({ ...v, k: Math.min(3.2, v.k * 1.2) }))}>+</button>
          <button className="btn sm ghost" title="Fit to screen" onClick={fit}>Fit</button>
          <button className="btn sm ghost" title="Reset zoom" onClick={() => setView({ k: 1, x: 0, y: 0 })}>1:1</button>
        </div>
      ) : null}

      <div className="canvas-legend">
        <span className="legend-key"><span className="legend-swatch" style={{ background: 'var(--active-link)' }} /> active</span>
        <span className="legend-key"><span className="legend-swatch" style={{ background: 'var(--warn)' }} /> congested</span>
        <span className="legend-key"><span className="legend-swatch" style={{ background: 'var(--bad)' }} /> failed</span>
        <span className="legend-key"><span className="legend-swatch" style={{ background: 'var(--packet)' }} /> route / packet</span>
        {addKind ? <span className="badge info">click canvas to place a {addKind}</span> : null}
        {tool === 'connect' ? <span className="badge info">connect: click two routers</span> : null}
        {tool === 'delete' ? <span className="badge bad">delete: click a node or link</span> : null}
      </div>
    </div>
  )
}
