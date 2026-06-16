import { Sheet, Tabs, TabPanel } from '@/components/primitives'
import { ChatIcon, PeopleIcon } from '@/components/icons'
import { ChatPanel, type ChatApi } from '@/islands/ChatPanel'
import { ParticipantsPanel } from '@/islands/ParticipantsPanel'
import { useRoomStore } from '@/store/useRoomStore'
import { useIsTouch } from '@/lib/useIsTouch'

/**
 * The unified Chat / People panel (Slack model): one docked island / mobile
 * sheet, tabbed. Lazy-loaded — see RoomRoute. Chat state is owned by RoomView
 * (so it survives this panel closing) and passed in.
 */
export function SidePanel({ chat }: { chat: ChatApi }) {
  const panel = useRoomStore((s) => s.panel)
  const setPanel = useRoomStore((s) => s.setPanel)
  const value = panel ?? 'chat'
  // Desktop docks this panel beside the live stage (the stage + control bar
  // reflow for it), so it must be NON-modal — you keep muting / leaving / using
  // the call while it's open. Mobile shows it as a modal bottom sheet (scrim +
  // focus trap + tap-to-dismiss), which is right for a small screen.
  const coarse = useIsTouch()

  return (
    <Sheet
      open={panel !== null}
      onOpenChange={(o) => !o && setPanel(null)}
      title={value === 'chat' ? 'Chat' : 'Participants'}
      flush
      hideTitle
      modal={coarse}
    >
      <Tabs
        items={[
          { value: 'chat', label: <><ChatIcon /> Chat</> },
          { value: 'people', label: <><PeopleIcon /> People</> },
        ]}
        value={value}
        onValueChange={(v) => setPanel(v as 'chat' | 'people')}
        className="min-h-0 flex-1 px-3 pt-1"
      >
        <TabPanel value="chat" className="-mx-3 mt-2 flex min-h-0 flex-col">
          <ChatPanel chat={chat} />
        </TabPanel>
        <TabPanel value="people" className="-mx-3 mt-2 flex min-h-0 flex-col">
          <ParticipantsPanel />
        </TabPanel>
      </Tabs>
    </Sheet>
  )
}
