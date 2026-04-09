import { usePanesStore, type PaneNode } from '@/stores/panes'
import { PaneView } from './PaneView'
import { ResizeHandle } from './ResizeHandle'

interface SplitContainerProps {
  node: PaneNode
  projectId: string
}

function SplitNodeRenderer({ node, projectId }: SplitContainerProps): JSX.Element {
  if (node.type === 'leaf') {
    return <PaneView paneId={node.id} projectId={projectId} />
  }

  const { direction, ratio, first, second } = node
  const isHorizontal = direction === 'horizontal'

  return (
    <div
      className="flex h-full w-full"
      style={{ flexDirection: isHorizontal ? 'row' : 'column' }}
    >
      <div style={{ flex: `0 0 ${ratio * 100}%`, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        <SplitNodeRenderer node={first} projectId={projectId} />
      </div>
      <ResizeHandle splitId={node.id} direction={direction} currentRatio={ratio} />
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        <SplitNodeRenderer node={second} projectId={projectId} />
      </div>
    </div>
  )
}

interface Props {
  projectId: string
}

export function SplitContainer({ projectId }: Props): JSX.Element {
  const root = usePanesStore((s) => s.root)
  return <SplitNodeRenderer node={root} projectId={projectId} />
}
