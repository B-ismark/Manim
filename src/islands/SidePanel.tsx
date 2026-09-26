import { useParticipants } from '@livekit/components-react'
import { Sheet, TabList, TabPanel, TabsRoot } from '@/components/primitives'
import { ChatIcon, PeopleIcon } from '@/components/icons'
import { ChatPanel, type ChatApi } from '@/islands/ChatPanel'
import { ParticipantsPanel } from '@/islands/ParticipantsPanel'
import { useRoomStore } from '@/store/useRoomStore'
import { useIsTouch } from '@/lib/useIsTouch'
import { useChatCompanion } from '@/lib/chatCompanion'

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

  // The head count rides on the People tab, so a busy call's size is readable
  // without leaving the conversation.
  const count = useParticipants({ updateOnlyOn: [] }).length

  // A phone keeps the call in view beside the panel (lib/chatCompanion).
  const companion = useChatCompanion()
  const dock =
    companion.mode === 'top'
      ? { top: companion.sheetTop }
      : companion.mode === 'side'
        ? { width: companion.panelW }
        : undefined

  return (
    <TabsRoot value={value} onValueChange={(v) => setPanel(v as 'chat' | 'people')}>
      <Sheet
        open={panel !== null}
        onOpenChange={(o) => !o && setPanel(null)}
        title={value === 'chat' ? 'Chat' : 'People'}
        flush
        hideTitle
        modal={coarse}
        expandable={coarse}
        dock={dock}
        headerContent={
          <TabList
            className="h-11 rounded-full [&>*]:rounded-full"
            items={[
              { value: 'chat', label: <><ChatIcon /> Chat</> },
              {
                value: 'people',
                label: (
                  <>
                    <PeopleIcon /> People
                    <span className="rounded-full bg-line px-1.5 text-xs font-semibold tabular-nums text-ink">{count}</span>
                  </>
                ),
              },
            ]}
          />
        }
      >
        <TabPanel value="chat" className="flex min-h-0 flex-col">
          <ChatPanel chat={chat} />
        </TabPanel>
        <TabPanel value="people" className="mt-2 flex min-h-0 flex-col">
          <ParticipantsPanel />
        </TabPanel>
      </Sheet>
    </TabsRoot>
  )
}
