import { useMemo, useState } from 'react'
import { cn } from '@/lib/cn'

/**
 * Built-in emoji picker. The web has no reliable *native* emoji-picker API (the
 * OS panel — Win + . / Cmd-Ctrl-Space — can't be opened programmatically), so a
 * built-in grid is the standard approach (Slack / Discord / WhatsApp all ship
 * their own). This carries a broad, categorized set plus a name search; it's a
 * static table (no dataset dependency, no network) so it stays bundle-light.
 */
interface EmojiDef {
  e: string
  /** Space-separated keywords for search. */
  k: string
}

interface Category {
  id: string
  label: string
  icon: string
  emojis: EmojiDef[]
}

// Curated but broad. Grouped the way pickers conventionally are; keywords drive
// the search box. Extend freely — the UI is data-driven.
const CATEGORIES: Category[] = [
  {
    id: 'smileys',
    label: 'Smileys & people',
    icon: '😀',
    emojis: [
      { e: '😀', k: 'grin smile happy' }, { e: '😃', k: 'smile happy joy' }, { e: '😄', k: 'smile happy laugh' },
      { e: '😁', k: 'grin beam' }, { e: '😆', k: 'laugh haha' }, { e: '😅', k: 'sweat laugh relief' },
      { e: '🤣', k: 'rofl rolling laugh' }, { e: '😂', k: 'joy tears laugh cry' }, { e: '🙂', k: 'slight smile' },
      { e: '🙃', k: 'upside down silly' }, { e: '😉', k: 'wink' }, { e: '😊', k: 'blush smile happy' },
      { e: '😇', k: 'innocent angel halo' }, { e: '🥰', k: 'love hearts adore' }, { e: '😍', k: 'heart eyes love' },
      { e: '🤩', k: 'star struck wow' }, { e: '😘', k: 'kiss blow love' }, { e: '😗', k: 'kiss' },
      { e: '😋', k: 'yum tasty tongue' }, { e: '😛', k: 'tongue playful' }, { e: '😜', k: 'wink tongue' },
      { e: '🤪', k: 'zany crazy goofy' }, { e: '😝', k: 'tongue squint' }, { e: '🤑', k: 'money mouth rich' },
      { e: '🤗', k: 'hug hands' }, { e: '🤭', k: 'oops giggle hand' }, { e: '🤫', k: 'shush quiet' },
      { e: '🤔', k: 'thinking hmm' }, { e: '🤐', k: 'zipper quiet secret' }, { e: '🤨', k: 'raised eyebrow doubt' },
      { e: '😐', k: 'neutral meh' }, { e: '😑', k: 'expressionless blank' }, { e: '😶', k: 'no mouth silent' },
      { e: '😏', k: 'smirk' }, { e: '😒', k: 'unamused meh' }, { e: '🙄', k: 'eye roll' },
      { e: '😬', k: 'grimace awkward' }, { e: '😔', k: 'sad pensive' }, { e: '😪', k: 'sleepy tired' },
      { e: '😴', k: 'sleep zzz' }, { e: '😌', k: 'relieved calm' },
      { e: '🥱', k: 'yawn bored tired' }, { e: '😷', k: 'mask sick' }, { e: '🤒', k: 'sick thermometer' },
      { e: '🤕', k: 'hurt bandage' }, { e: '🤢', k: 'nausea sick gross' }, { e: '🤮', k: 'vomit sick' },
      { e: '🥵', k: 'hot heat' }, { e: '🥶', k: 'cold freezing' }, { e: '😵', k: 'dizzy ko' },
      { e: '🤯', k: 'mind blown explode' }, { e: '🤠', k: 'cowboy' }, { e: '🥳', k: 'party celebrate' },
      { e: '😎', k: 'cool sunglasses' }, { e: '🤓', k: 'nerd geek' }, { e: '🧐', k: 'monocle inspect' },
      { e: '😕', k: 'confused' }, { e: '😟', k: 'worried' }, { e: '🙁', k: 'frown sad' },
      { e: '😮', k: 'wow open mouth' }, { e: '😯', k: 'hushed surprised' }, { e: '😲', k: 'astonished shock' },
      { e: '😳', k: 'flushed embarrassed' }, { e: '🥺', k: 'pleading puppy eyes beg' }, { e: '😦', k: 'frown open' },
      { e: '😢', k: 'cry sad tear' }, { e: '😭', k: 'sob cry bawl' }, { e: '😤', k: 'huff steam mad' },
      { e: '😠', k: 'angry mad' }, { e: '😡', k: 'rage furious' }, { e: '🤬', k: 'swearing curse' },
      { e: '😈', k: 'devil imp evil' }, { e: '💀', k: 'skull dead' }, { e: '👻', k: 'ghost boo' },
      { e: '👋', k: 'wave hello hi bye' }, { e: '🤚', k: 'back hand' }, { e: '🖐️', k: 'hand five' },
      { e: '✋', k: 'hand stop high five' }, { e: '👌', k: 'ok perfect' }, { e: '🤌', k: 'pinch italian' },
      { e: '🤏', k: 'small pinch' }, { e: '✌️', k: 'peace victory' }, { e: '🤞', k: 'fingers crossed luck' },
      { e: '🤟', k: 'love you' }, { e: '🤘', k: 'rock horns' }, { e: '🤙', k: 'call me shaka' },
      { e: '👈', k: 'point left' }, { e: '👉', k: 'point right' }, { e: '👆', k: 'point up' },
      { e: '👇', k: 'point down' }, { e: '☝️', k: 'point up one' }, { e: '👍', k: 'thumbs up like yes good' },
      { e: '👎', k: 'thumbs down dislike no bad' }, { e: '✊', k: 'fist raised' }, { e: '👊', k: 'fist bump punch' },
      { e: '👏', k: 'clap applause bravo' }, { e: '🙌', k: 'raise hands celebrate praise' }, { e: '🙏', k: 'pray thanks please' },
      { e: '🤝', k: 'handshake deal' }, { e: '💪', k: 'muscle strong flex' }, { e: '🫶', k: 'heart hands love' },
    ],
  },
  {
    id: 'hearts',
    label: 'Hearts & symbols',
    icon: '❤️',
    emojis: [
      { e: '❤️', k: 'red heart love' }, { e: '🧡', k: 'orange heart' }, { e: '💛', k: 'yellow heart' },
      { e: '💚', k: 'green heart' }, { e: '💙', k: 'blue heart' }, { e: '💜', k: 'purple heart' },
      { e: '🖤', k: 'black heart' }, { e: '🤍', k: 'white heart' }, { e: '🤎', k: 'brown heart' },
      { e: '💔', k: 'broken heart' }, { e: '❣️', k: 'heart exclamation' }, { e: '💕', k: 'two hearts love' },
      { e: '💞', k: 'revolving hearts' }, { e: '💓', k: 'beating heart' }, { e: '💗', k: 'growing heart' },
      { e: '💖', k: 'sparkling heart' }, { e: '💘', k: 'heart arrow cupid' }, { e: '💝', k: 'heart gift' },
      { e: '💟', k: 'heart decoration' }, { e: '❤️‍🔥', k: 'heart fire' }, { e: '💌', k: 'love letter' },
      { e: '💋', k: 'kiss lips' }, { e: '💯', k: 'hundred perfect score' }, { e: '✨', k: 'sparkles shiny' },
      { e: '🔥', k: 'fire lit hot' }, { e: '⭐', k: 'star' }, { e: '🌟', k: 'glowing star' },
      { e: '💫', k: 'dizzy stars' }, { e: '⚡', k: 'lightning bolt zap' }, { e: '💥', k: 'boom collision' },
      { e: '🎉', k: 'tada party celebrate' }, { e: '🎊', k: 'confetti party' }, { e: '🎈', k: 'balloon' },
      { e: '✅', k: 'check done yes' }, { e: '❌', k: 'cross no wrong' }, { e: '❓', k: 'question' },
      { e: '❗', k: 'exclamation' }, { e: '💤', k: 'sleep zzz' }, { e: '💢', k: 'anger mad' },
      { e: '💬', k: 'speech chat' }, { e: '👀', k: 'eyes look watching' }, { e: '🫥', k: 'dotted face invisible' },
    ],
  },
  {
    id: 'animals',
    label: 'Animals & nature',
    icon: '🐶',
    emojis: [
      { e: '🐶', k: 'dog puppy' }, { e: '🐱', k: 'cat kitten' }, { e: '🐭', k: 'mouse' }, { e: '🐹', k: 'hamster' },
      { e: '🐰', k: 'rabbit bunny' }, { e: '🦊', k: 'fox' }, { e: '🐻', k: 'bear' }, { e: '🐼', k: 'panda' },
      { e: '🐨', k: 'koala' }, { e: '🐯', k: 'tiger' }, { e: '🦁', k: 'lion' }, { e: '🐮', k: 'cow' },
      { e: '🐷', k: 'pig' }, { e: '🐸', k: 'frog' }, { e: '🐵', k: 'monkey' }, { e: '🐔', k: 'chicken' },
      { e: '🐧', k: 'penguin' }, { e: '🐦', k: 'bird' }, { e: '🦄', k: 'unicorn' }, { e: '🐝', k: 'bee' },
      { e: '🦋', k: 'butterfly' }, { e: '🐢', k: 'turtle' }, { e: '🐙', k: 'octopus' }, { e: '🐠', k: 'fish' },
      { e: '🐳', k: 'whale' }, { e: '🐬', k: 'dolphin' }, { e: '🦈', k: 'shark' }, { e: '🌷', k: 'tulip flower' },
      { e: '🌸', k: 'blossom flower' }, { e: '🌹', k: 'rose flower' }, { e: '🌻', k: 'sunflower' }, { e: '🌳', k: 'tree' },
      { e: '🌲', k: 'evergreen tree' }, { e: '🌵', k: 'cactus' }, { e: '🍀', k: 'clover luck' }, { e: '🌈', k: 'rainbow' },
      { e: '☀️', k: 'sun sunny' }, { e: '⛅', k: 'cloud sun' }, { e: '🌧️', k: 'rain' }, { e: '❄️', k: 'snow cold' },
      { e: '🌙', k: 'moon night' }, { e: '🌊', k: 'wave ocean water' },
    ],
  },
  {
    id: 'food',
    label: 'Food & drink',
    icon: '🍔',
    emojis: [
      { e: '🍏', k: 'apple green' }, { e: '🍎', k: 'apple red' }, { e: '🍐', k: 'pear' }, { e: '🍊', k: 'orange' },
      { e: '🍋', k: 'lemon' }, { e: '🍌', k: 'banana' }, { e: '🍉', k: 'watermelon' }, { e: '🍇', k: 'grapes' },
      { e: '🍓', k: 'strawberry' }, { e: '🫐', k: 'blueberry' }, { e: '🍒', k: 'cherry' }, { e: '🍑', k: 'peach' },
      { e: '🥭', k: 'mango' }, { e: '🍍', k: 'pineapple' }, { e: '🥥', k: 'coconut' }, { e: '🥝', k: 'kiwi' },
      { e: '🍅', k: 'tomato' }, { e: '🥑', k: 'avocado' }, { e: '🌽', k: 'corn' }, { e: '🥕', k: 'carrot' },
      { e: '🍔', k: 'burger hamburger' }, { e: '🍟', k: 'fries' }, { e: '🍕', k: 'pizza' }, { e: '🌭', k: 'hotdog' },
      { e: '🌮', k: 'taco' }, { e: '🌯', k: 'burrito' }, { e: '🍣', k: 'sushi' }, { e: '🍜', k: 'noodles ramen' },
      { e: '🍝', k: 'pasta spaghetti' }, { e: '🍤', k: 'shrimp tempura' }, { e: '🍰', k: 'cake slice' }, { e: '🎂', k: 'birthday cake' },
      { e: '🍩', k: 'donut' }, { e: '🍪', k: 'cookie' }, { e: '🍫', k: 'chocolate' }, { e: '🍬', k: 'candy' },
      { e: '🍦', k: 'ice cream' }, { e: '☕', k: 'coffee tea' }, { e: '🍵', k: 'tea green' }, { e: '🍺', k: 'beer' },
      { e: '🍻', k: 'cheers beers' }, { e: '🥂', k: 'champagne cheers toast' }, { e: '🍷', k: 'wine' }, { e: '🥤', k: 'soda drink' },
    ],
  },
  {
    id: 'activities',
    label: 'Activities & travel',
    icon: '⚽',
    emojis: [
      { e: '⚽', k: 'soccer football' }, { e: '🏀', k: 'basketball' }, { e: '🏈', k: 'football american' }, { e: '⚾', k: 'baseball' },
      { e: '🎾', k: 'tennis' }, { e: '🏐', k: 'volleyball' }, { e: '🏉', k: 'rugby' }, { e: '🎱', k: 'pool billiards 8 ball' },
      { e: '🏓', k: 'ping pong table tennis' }, { e: '🏸', k: 'badminton' }, { e: '🥅', k: 'goal net' }, { e: '⛳', k: 'golf' },
      { e: '🏆', k: 'trophy win champion' }, { e: '🥇', k: 'gold medal first' }, { e: '🥈', k: 'silver medal second' }, { e: '🥉', k: 'bronze medal third' },
      { e: '🎮', k: 'game controller gaming' }, { e: '🎲', k: 'dice' }, { e: '🎯', k: 'target dart bullseye' }, { e: '🎸', k: 'guitar music' },
      { e: '🎹', k: 'piano keyboard music' }, { e: '🎤', k: 'mic sing karaoke' }, { e: '🎧', k: 'headphones music' }, { e: '🎬', k: 'movie clapper film' },
      { e: '🎨', k: 'art palette paint' }, { e: '🚗', k: 'car' }, { e: '🚕', k: 'taxi' }, { e: '🚌', k: 'bus' },
      { e: '🚀', k: 'rocket launch' }, { e: '✈️', k: 'plane flight travel' }, { e: '🚁', k: 'helicopter' }, { e: '🚢', k: 'ship boat' },
      { e: '🚲', k: 'bike bicycle' }, { e: '🏍️', k: 'motorcycle' }, { e: '🗺️', k: 'map travel' }, { e: '🏝️', k: 'island beach' },
      { e: '🏔️', k: 'mountain' }, { e: '🗽', k: 'statue liberty' }, { e: '🎡', k: 'ferris wheel' }, { e: '🎢', k: 'roller coaster' },
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    icon: '💡',
    emojis: [
      { e: '💡', k: 'bulb idea light' }, { e: '🔦', k: 'flashlight' }, { e: '📱', k: 'phone mobile' }, { e: '💻', k: 'laptop computer' },
      { e: '🖥️', k: 'desktop monitor' }, { e: '⌨️', k: 'keyboard' }, { e: '🖱️', k: 'mouse' }, { e: '🖨️', k: 'printer' },
      { e: '📷', k: 'camera photo' }, { e: '📹', k: 'video camera' }, { e: '🎥', k: 'movie camera' }, { e: '📺', k: 'tv television' },
      { e: '🔋', k: 'battery' }, { e: '🔌', k: 'plug power' }, { e: '💾', k: 'floppy save disk' }, { e: '💿', k: 'cd disc' },
      { e: '📦', k: 'package box' }, { e: '✉️', k: 'envelope mail' }, { e: '📧', k: 'email' }, { e: '📝', k: 'memo note write' },
      { e: '📌', k: 'pin location' }, { e: '📎', k: 'paperclip attach' }, { e: '🔑', k: 'key' }, { e: '🔒', k: 'lock secure' },
      { e: '🔓', k: 'unlock open' }, { e: '🔔', k: 'bell notification' }, { e: '🔕', k: 'mute bell off' }, { e: '⏰', k: 'alarm clock' },
      { e: '⏳', k: 'hourglass wait' }, { e: '💰', k: 'money bag' }, { e: '💵', k: 'dollar cash money' }, { e: '💳', k: 'credit card' },
      { e: '🎁', k: 'gift present' }, { e: '🛒', k: 'cart shopping' }, { e: '🔧', k: 'wrench fix tool' }, { e: '🔨', k: 'hammer' },
      { e: '🧪', k: 'test tube science' }, { e: '🔬', k: 'microscope' }, { e: '📚', k: 'books study' }, { e: '✏️', k: 'pencil write' },
    ],
  },
]

const ALL = CATEGORIES.flatMap((c) => c.emojis)

export function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [active, setActive] = useState(CATEGORIES[0].id)
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    const seen = new Set<string>()
    return ALL.filter((d) => {
      if (seen.has(d.e)) return false
      if (!d.k.includes(q)) return false
      seen.add(d.e)
      return true
    })
  }, [query])

  const shown = results ?? CATEGORIES.find((c) => c.id === active)?.emojis ?? []

  return (
    <div className="flex w-72 flex-col gap-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search emoji"
        aria-label="Search emoji"
        className="h-8 rounded-field bg-sunken px-2.5 text-sm outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent"
      />

      {!results && (
        <div className="flex gap-0.5" role="tablist" aria-label="Emoji categories">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={active === c.id}
              aria-label={c.label}
              title={c.label}
              onClick={() => setActive(c.id)}
              className={cn(
                'grid flex-1 place-items-center rounded-control py-1 text-lg',
                active === c.id ? 'bg-accent-soft' : 'hover:bg-sunken',
              )}
            >
              {c.icon}
            </button>
          ))}
        </div>
      )}

      <div className="grid max-h-52 grid-cols-7 gap-0.5 overflow-y-auto overscroll-contain">
        {shown.length === 0 ? (
          <p className="col-span-7 py-6 text-center text-xs text-ink-subtle">No emoji found</p>
        ) : (
          shown.map((d) => (
            <button
              key={d.e}
              type="button"
              aria-label={d.k.split(' ')[0]}
              onClick={() => onSelect(d.e)}
              className="grid aspect-square place-items-center rounded-control text-xl hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none"
            >
              {d.e}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
