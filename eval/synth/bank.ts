import type { ItemType } from "@repo/contracts";
import type { SynthConfig } from "./config";
import { Rng } from "./rng";

/**
 * The question bank (REQ §3, §5.2 "Content"): 8 notes of 19 facts each, so 152 questions. Every
 * question is a template over one fact, with no LLM: an MCQ asks for the fact's answer, and its
 * three distractors are other answers of the same note. Each note is one topic (topic key
 * `src:<source id>`), as for real notes until topics exist.
 */

/** One fact of a note, in the three forms the templates need. */
export interface Fact {
  /** The MCQ / short-answer question. */
  question: string;
  /** The answer, also the MCQ's correct option. */
  answer: string;
  /** The sentence in the note. */
  statement: string;
  /** The statement with the answer blanked out, for cloze. */
  cloze: string;
}

export interface NoteTemplate {
  title: string;
  facts: readonly Fact[];
}

const BLANK = "____";

/** Facts from (subject, answer) pairs and one sentence pattern per form. */
function pairs(
  rows: readonly (readonly [string, string])[],
  forms: { question: (s: string) => string; statement: (s: string, a: string) => string },
): Fact[] {
  return rows.map(([subject, answer]) => ({
    question: forms.question(subject),
    answer,
    statement: forms.statement(subject, answer),
    cloze: forms.statement(subject, BLANK),
  }));
}

export const NOTES: readonly NoteTemplate[] = [
  {
    title: "Geography — World capitals",
    facts: pairs(
      [
        ["France", "Paris"],
        ["Germany", "Berlin"],
        ["Japan", "Tokyo"],
        ["Canada", "Ottawa"],
        ["Australia", "Canberra"],
        ["Brazil", "Brasília"],
        ["Egypt", "Cairo"],
        ["Kenya", "Nairobi"],
        ["Russia", "Moscow"],
        ["China", "Beijing"],
        ["Italy", "Rome"],
        ["Spain", "Madrid"],
        ["Argentina", "Buenos Aires"],
        ["South Korea", "Seoul"],
        ["Turkey", "Ankara"],
        ["Nepal", "Kathmandu"],
        ["Thailand", "Bangkok"],
        ["Mexico", "Mexico City"],
        ["New Zealand", "Wellington"],
      ],
      {
        question: (s) => `What is the capital of ${s}?`,
        statement: (s, a) => `The capital of ${s} is ${a}.`,
      },
    ),
  },
  {
    title: "Chemistry — Element symbols",
    facts: pairs(
      [
        ["H", "Hydrogen"],
        ["He", "Helium"],
        ["C", "Carbon"],
        ["N", "Nitrogen"],
        ["O", "Oxygen"],
        ["Na", "Sodium"],
        ["Mg", "Magnesium"],
        ["Al", "Aluminium"],
        ["Si", "Silicon"],
        ["P", "Phosphorus"],
        ["S", "Sulfur"],
        ["Cl", "Chlorine"],
        ["K", "Potassium"],
        ["Ca", "Calcium"],
        ["Fe", "Iron"],
        ["Cu", "Copper"],
        ["Ag", "Silver"],
        ["Au", "Gold"],
        ["Pb", "Lead"],
      ],
      {
        question: (s) => `Which element has the chemical symbol ${s}?`,
        statement: (s, a) => `${s} is the chemical symbol of ${a}.`,
      },
    ),
  },
  {
    title: "Physics — SI units",
    facts: pairs(
      [
        ["force", "newton"],
        ["energy", "joule"],
        ["power", "watt"],
        ["pressure", "pascal"],
        ["electric charge", "coulomb"],
        ["electric potential difference", "volt"],
        ["electrical resistance", "ohm"],
        ["capacitance", "farad"],
        ["frequency", "hertz"],
        ["magnetic flux", "weber"],
        ["magnetic flux density", "tesla"],
        ["inductance", "henry"],
        ["thermodynamic temperature", "kelvin"],
        ["amount of substance", "mole"],
        ["luminous intensity", "candela"],
        ["length", "metre"],
        ["mass", "kilogram"],
        ["time", "second"],
        ["electric current", "ampere"],
      ],
      {
        question: (s) => `What is the SI unit of ${s}?`,
        statement: (s, a) => `The SI unit of ${s} is the ${a}.`,
      },
    ),
  },
  {
    title: "Literature — Classic novels",
    facts: pairs(
      [
        ["Pride and Prejudice", "Jane Austen"],
        ["Nineteen Eighty-Four", "George Orwell"],
        ["To Kill a Mockingbird", "Harper Lee"],
        ["The Great Gatsby", "F. Scott Fitzgerald"],
        ["Moby-Dick", "Herman Melville"],
        ["War and Peace", "Leo Tolstoy"],
        ["Crime and Punishment", "Fyodor Dostoevsky"],
        ["Don Quixote", "Miguel de Cervantes"],
        ["Jane Eyre", "Charlotte Brontë"],
        ["Wuthering Heights", "Emily Brontë"],
        ["Great Expectations", "Charles Dickens"],
        ["The Adventures of Tom Sawyer", "Mark Twain"],
        ["One Hundred Years of Solitude", "Gabriel García Márquez"],
        ["Frankenstein", "Mary Shelley"],
        ["The Old Man and the Sea", "Ernest Hemingway"],
        ["Gitanjali", "Rabindranath Tagore"],
        ["Things Fall Apart", "Chinua Achebe"],
        ["The Picture of Dorian Gray", "Oscar Wilde"],
        ["Godaan", "Munshi Premchand"],
      ],
      {
        question: (s) => `Who wrote “${s}”?`,
        statement: (s, a) => `“${s}” was written by ${a}.`,
      },
    ),
  },
  {
    title: "Science — Famous scientists",
    facts: pairs(
      [
        ["the theory of general relativity", "Albert Einstein"],
        ["the discovery of penicillin", "Alexander Fleming"],
        ["pioneering research on radioactivity", "Marie Curie"],
        ["the theory of evolution by natural selection", "Charles Darwin"],
        ["the three laws of motion", "Isaac Newton"],
        ["the heliocentric model of the solar system", "Nicolaus Copernicus"],
        ["the periodic table of the elements", "Dmitri Mendeleev"],
        ["the laws of inheritance found in pea plants", "Gregor Mendel"],
        ["the equations of electromagnetism", "James Clerk Maxwell"],
        ["the first smallpox vaccine", "Edward Jenner"],
        ["pasteurisation", "Louis Pasteur"],
        ["the quantum hypothesis of energy", "Max Planck"],
        ["the uncertainty principle", "Werner Heisenberg"],
        ["the Raman effect", "C. V. Raman"],
        ["the discovery of the electron", "J. J. Thomson"],
        ["the discovery of the atomic nucleus", "Ernest Rutherford"],
        ["the first patent for the telephone", "Alexander Graham Bell"],
        ["the discovery of the neutron", "James Chadwick"],
        ["the alternating-current induction motor", "Nikola Tesla"],
      ],
      {
        question: (s) => `Who is known for ${s}?`,
        statement: (s, a) => `${a} is known for ${s}.`,
      },
    ),
  },
  {
    title: "History — Key dates",
    facts: (
      [
        ["did the French Revolution begin", "1789", "The French Revolution began in {}."],
        ["did the First World War begin", "1914", "The First World War began in {}."],
        ["did the Second World War end", "1945", "The Second World War ended in {}."],
        ["did India become independent", "1947", "India became independent in {}."],
        ["did Apollo 11 land on the Moon", "1969", "Apollo 11 landed on the Moon in {}."],
        ["did the Berlin Wall fall", "1989", "The Berlin Wall fell in {}."],
        [
          "did Columbus first reach the Americas",
          "1492",
          "Columbus first reached the Americas in {}.",
        ],
        ["was the Magna Carta sealed", "1215", "The Magna Carta was sealed in {}."],
        [
          "was the US Declaration of Independence adopted",
          "1776",
          "The US Declaration of Independence was adopted in {}.",
        ],
        [
          "did the Russian Revolution take place",
          "1917",
          "The Russian Revolution took place in {}.",
        ],
        ["was the Battle of Plassey fought", "1757", "The Battle of Plassey was fought in {}."],
        [
          "was the First Battle of Panipat fought",
          "1526",
          "The First Battle of Panipat was fought in {}.",
        ],
        ["did the Indian Rebellion begin", "1857", "The Indian Rebellion began in {}."],
        [
          "did the Constitution of India come into force",
          "1950",
          "The Constitution of India came into force in {}.",
        ],
        ["was the Soviet Union dissolved", "1991", "The Soviet Union was dissolved in {}."],
        [
          "did Constantinople fall to the Ottomans",
          "1453",
          "Constantinople fell to the Ottomans in {}.",
        ],
        [
          "was the Treaty of Versailles signed",
          "1919",
          "The Treaty of Versailles was signed in {}.",
        ],
        ["did Gandhi lead the Salt March", "1930", "Gandhi led the Salt March in {}."],
        ["was Bengal first partitioned", "1905", "Bengal was first partitioned in {}."],
      ] as const
    ).map(([stem, answer, sentence]) => ({
      question: `In which year ${stem}?`,
      answer,
      statement: sentence.replace("{}", answer),
      cloze: sentence.replace("{}", BLANK),
    })),
  },
  {
    title: "Mathematics — Mensuration formulas",
    facts: pairs(
      [
        ["the area of a circle", "πr²"],
        ["the circumference of a circle", "2πr"],
        ["the surface area of a sphere", "4πr²"],
        ["the volume of a sphere", "(4/3)πr³"],
        ["the area of a triangle", "½bh"],
        ["the volume of a cylinder", "πr²h"],
        ["the volume of a cone", "(1/3)πr²h"],
        ["the area of a rectangle", "lw"],
        ["the area of a trapezium", "½(a + b)h"],
        ["the perimeter of a square", "4a"],
        ["the volume of a cube", "a³"],
        ["the area of a parallelogram", "bh"],
        ["the curved surface area of a cylinder", "2πrh"],
        ["the perimeter of a rectangle", "2(l + w)"],
        ["the area of a square", "a²"],
        ["the surface area of a cube", "6a²"],
        ["the volume of a cuboid", "lwh"],
        ["the diagonal of a square", "a√2"],
        ["the area of an equilateral triangle", "(√3/4)a²"],
      ],
      {
        question: (s) => `What is the formula for ${s}?`,
        statement: (s, a) => `The formula for ${s} is ${a}.`,
      },
    ),
  },
  {
    title: "Computing — Common acronyms",
    facts: pairs(
      [
        ["CPU", "Central Processing Unit"],
        ["RAM", "Random Access Memory"],
        ["HTTP", "HyperText Transfer Protocol"],
        ["HTML", "HyperText Markup Language"],
        ["SQL", "Structured Query Language"],
        ["DNS", "Domain Name System"],
        ["URL", "Uniform Resource Locator"],
        ["GPU", "Graphics Processing Unit"],
        ["API", "Application Programming Interface"],
        ["TCP", "Transmission Control Protocol"],
        ["IP", "Internet Protocol"],
        ["USB", "Universal Serial Bus"],
        ["ROM", "Read-Only Memory"],
        ["PDF", "Portable Document Format"],
        ["JSON", "JavaScript Object Notation"],
        ["CSS", "Cascading Style Sheets"],
        ["LAN", "Local Area Network"],
        ["OS", "Operating System"],
        ["SSD", "Solid-State Drive"],
      ],
      {
        question: (s) => `What does ${s} stand for?`,
        statement: (s, a) => `${s} stands for ${a}.`,
      },
    ),
  },
];

/** One question of the bank, before any student owns a copy. Positions, not ids. */
export interface BankItem {
  /** Position in release order (note by note, fact by fact). */
  index: number;
  note: number;
  fact: number;
  /** The chunk of its note it is generated from. */
  chunk: number;
  type: ItemType;
  prompt: string;
  answer: string;
  /** MCQ: the option texts in stored order, the answer among them. Empty for the other types. */
  options: readonly string[];
  /** The simulated day (0-based) it appears on, or "end": on the end day (endDayBatch). */
  releaseDay: number | "end";
}

/**
 * The bank in release order: note by note, fact by fact, `releaseBatch` questions every
 * `releaseEveryDays` days from day 0 (REQ §3), the last `endDayBatch` on the end day (SS-7).
 * Each item's type is drawn from `typeMix`, its
 * distractors from its note; both are seeded by the bank alone, so every student gets the same
 * questions (each in their own rows). Pure.
 */
export function buildBank(cfg: SynthConfig): BankItem[] {
  const { content } = cfg;
  const types = Object.entries(content.typeMix).filter(([, share]) => (share ?? 0) > 0) as [
    ItemType,
    number,
  ][];
  const total = types.reduce((sum, [, share]) => sum + share, 0);
  if (total <= 0) throw new Error("content.typeMix needs at least one type with a share");

  const items: BankItem[] = [];
  NOTES.forEach((note, n) => {
    note.facts.forEach((fact, f) => {
      const rng = new Rng("bank", n, f);
      const index = items.length;
      let pick = rng.next() * total;
      const type = types.find(([, share]) => (pick -= share) < 0)?.[0] ?? types[0]![0];
      const others = note.facts.filter((other) => other.answer !== fact.answer);
      const distractors = rng.shuffle(others).slice(0, 3);
      items.push({
        index,
        note: n,
        fact: f,
        chunk: Math.floor(f / content.factsPerChunk),
        type,
        prompt: type === "cloze" ? fact.cloze : fact.question,
        answer: fact.answer,
        options:
          type === "mcq" ? rng.shuffle([fact.answer, ...distractors.map((d) => d.answer)]) : [],
        releaseDay: 0,
      });
    });
  });
  const heldBack = items.length - content.endDayBatch;
  return items.map((item) => ({
    ...item,
    releaseDay:
      item.index >= heldBack
        ? "end"
        : Math.floor(item.index / content.releaseBatch) * content.releaseEveryDays,
  }));
}

/** The text of chunk `chunk` of note `note`: its facts' sentences. */
export function chunkText(note: number, chunk: number, cfg: SynthConfig): string {
  const facts = NOTES[note]?.facts ?? [];
  const per = cfg.content.factsPerChunk;
  return facts
    .slice(chunk * per, (chunk + 1) * per)
    .map((fact) => fact.statement)
    .join(" ");
}

/** How many chunks note `note` has. */
export function chunkCount(note: number, cfg: SynthConfig): number {
  return Math.ceil((NOTES[note]?.facts.length ?? 0) / cfg.content.factsPerChunk);
}
