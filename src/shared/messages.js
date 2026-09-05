export const MESSAGES = {
  idle: [
    "Just hanging out on my doghouse roof.",
    "Curse you, red baron... anyway, hi!",
    "It was a dark and stormy night... just kidding, it's nice out.",
    "Click me for a hello!",
    "Woodstock says hi too.",
    "Waiting for something fun to happen.",
  ],
  petted: [
    "Hehe, that tickles!",
    "Best. Day. Ever.",
    "You're my favorite human.",
    "Woof! More of that please.",
    "This is the good life.",
  ],
  focusStart: [
    "Focus mode: on. Let's do this!",
    "I'll keep watch. You keep working.",
    "Time to be a Fifi-level student.",
    "Deep breath. Here we go.",
  ],
  focusTick: [
    "You're doing great, keep going.",
    "I believe in you!",
    "Every minute counts. Nice work.",
    "Almost there, don't stop now.",
    "I'm cheering for you from up here.",
  ],
  focusComplete: [
    "Session complete! You earned it.",
    "That's how it's done!",
    "Great focus! Time for a breather.",
    "Look at you go. So proud.",
  ],
  breakStart: [
    "Break time! Stretch those legs.",
    "Go get some water, I'll wait.",
    "Rest is part of the work too.",
    "Five minutes of pure doghouse vibes.",
  ],
  breakComplete: [
    "Break's over - ready when you are.",
    "Back to it! You've got this.",
    "Refreshed and ready to roll.",
  ],
  sleepy: [
    "It's getting late... just five more minutes.",
    "Zzz... supper time is my alarm clock.",
    "Shh, I'm dreaming about the Red Baron.",
    "Way past a good dog's bedtime.",
  ],
  levelUp: [
    "Level up! You're unstoppable.",
    "New level, who dis?",
    "Look at us go!",
  ],
};

export function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}
