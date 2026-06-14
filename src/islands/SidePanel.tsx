import { Sheet, Tabs, TabPanel } from '@/components/primitives'
import { ChatIcon, PeopleIcon } from '@/components/icons'
import { ChatPanel } from '@/islands/ChatPanel'
import { ParticipantsPanel } from '@/islands/ParticipantsPanel'
import { useRoomStore } from '@/store/useRoomStore'

/**
 * The unified Chat / People panel (Slack model): one docked island / mobile
 * sheet, tabbed. Lazy-loaded — see RoomRoute.
 */
export function SidePanel() {
  const panel = useRoomStore((s) => s.panel)
  const setPanel = useRoomStore((s) => s.setPanel)
  const value = panel ?? 'chat'

  return (
    <Sheet
      open={panel !== null}
      onOpenChange={(o) => !o && setPanel(null)}
      title={value === 'chat' ? 'Chat' : 'Participants'}
      flush
      hideTitle
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
          <ChatPanel />
        </TabPanel>
        <TabPanel value="people" className="-mx-3 mt-2 flex min-h-0 flex-col">
          <ParticipantsPanel />
        </TabPanel>
      </Tabs>
    </Sheet>
  )
}
