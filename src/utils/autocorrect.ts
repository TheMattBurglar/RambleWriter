// Deterministic Autocorrect Engine for RambleWriter

export interface AutocorrectUndo {
  original: string;
  corrected: string;
  index: number; // Character index where the replacement occurred
  cursorPosition: number; // Position after the replacement
}

export const TYPO_MAP: Record<string, string> = {
  // Specific typos
  "conciousness": "consciousness",
  "grammer": "grammar",
  "posible": "possible",
  "waisted": "wasted",
  "functioanl": "functional",
  "apeal": "appeal",

  // Standard high-frequency typos
  "teh": "the",
  "recieve": "receive",
  "recieved": "received",
  "recieving": "receiving",
  "beleive": "believe",
  "beleived": "believed",
  "wierd": "weird",
  "seperate": "separate",
  "seperated": "separated",
  "seperating": "separating",
  "definately": "definitely",
  "alot": "a lot",
  "dont": "don't",
  "cant": "can't",
  "wont": "won't",
  "havent": "haven't",
  "hasnt": "hasn't",
  "arent": "aren't",
  "isnt": "isn't",
  "couldnt": "couldn't",
  "wouldnt": "wouldn't",
  "shouldnt": "shouldn't",
  "theyre": "they're",
  "youre": "you're",
  "weve": "we've",
  "ive": "I've",
  "im": "I'm",
  "didnt": "didn't",
  "doesnt": "doesn't",
  "wasnt": "wasn't",
  "werent": "weren't",

  // Words with doubled letters or silent letters
  "acommodate": "accommodate",
  "acommdate": "accommodate",
  "embarass": "embarrass",
  "embarassed": "embarrassed",
  "occured": "occurred",
  "occuring": "occurring",
  "occurance": "occurrence",
  "goverment": "government",
  "enviroment": "environment",
  "harrass": "harass",
  "harrassment": "harassment",
  "neccessary": "necessary",
  "necesary": "necessary",
  "unneccessary": "unnecessary",
  "torrow": "tomorrow",
  "tommorow": "tomorrow",
  "tommow": "tomorrow",
  "tomorow": "tomorrow",
  "unfortunatly": "unfortunately",
  "dissapoint": "disappoint",
  "dissapointed": "disappointed",
  "dissapointment": "disappointment",
  "recommand": "recommend",
  "recommanded": "recommended",
  "suprise": "surprise",
  "suprised": "surprised",
  "untill": "until",
  "truely": "truly",
  "accross": "across",
  "comming": "coming",
  "writting": "writing",
  "writen": "written",
  "commited": "committed",
  "comittee": "committee",

  // "because" variants (most common fast-typing transpositions)
  "becasue": "because",
  "beacuse": "because",
  "beause": "because",
  "bcause": "because",

  // "something" variants
  "soemthing": "something",
  "somthing": "something",
  "somethign": "something",
  "smething": "something",

  // High-frequency single-word transpositions
  "jsut": "just",
  "jstu": "just",
  "taht": "that",
  "tath": "that",
  "wiht": "with",
  "whit": "with",
  "thier": "their",
  "htink": "think",
  "thnik": "think",
  "wehre": "where",
  "waht": "what",
  "whta": "what",
  "tehn": "then",
  "tehy": "they",
  "htey": "they",
  "woudl": "would",
  "wuold": "would",
  "coudl": "could",
  "cuold": "could",
  "shoudl": "should",
  "shuold": "should",
  "hvae": "have",
  "ahve": "have",
  "liek": "like",
  "aslo": "also",
  "alos": "also",
  "onyl": "only",
  "olny": "only",
  "itno": "into",
  "inot": "into",
  "agian": "again",
  "peopel": "people",
  "peolpe": "people",
  "otehr": "other",
  "oehtr": "other",
  "beofre": "before",
  "befroe": "before",
  "littel": "little",
  "frist": "first",
  "fisrt": "first",
  "rigth": "right",
  "rgiht": "right",
  "aroudn": "around",
  "evrey": "every",
  "nver": "never",
  "tehse": "these",
  "tehm": "them",
  "htem": "them",
  "wehn": "when",
  "whne": "when",
  "tiem": "time",
  "mroe": "more",
  "mreo": "more",
  "konw": "know",
  "knwo": "know",
  "dwon": "down",
  "donw": "down",
  "vrey": "very",
  "veyr": "very",
  "bcak": "back",
  "brige": "bridge",

  // Common -ing transpositions (fingers outrun the keyboard on fast -ing endings)
  "goign": "going",
  "giong": "going",
  "beign": "being",
  "bieng": "being",
  "doign": "doing",
  "diong": "doing",
  "takign": "taking",
  "makign": "making",
  "lookign": "looking",
  "gettign": "getting",
  "sayign": "saying",
  "havign": "having",
  "comign": "coming",

  // Common visual / typing slips
  "abouta": "about a",
  "agains": "against",
  "algebre": "algebra",
  "allmost": "almost",
  "alotof": "a lot of",
  "amature": "amateur",
  "analise": "analyse",
  "analisys": "analysis",
  "arguement": "argument",
  "arguements": "arguments",
  "assistent": "assistant",
  "athiest": "atheist",
  "begining": "beginning",
  "busines": "business",
  "colleague": "colleague",
  "legue": "league",
  "conscios": "conscious",
  "correcter": "corrector",
  "decission": "decision",
  "desprate": "desperate",
  "develope": "develop",
  "developement": "development",
  "differant": "different",
  "diffrent": "different",
  "disasterous": "disastrous",
  "existance": "existence",
  "existant": "existent",
  "extream": "extreme",
  "familar": "familiar",
  "febuary": "February",
  "foriegn": "foreign",
  "fourty": "forty",
  "foward": "forward",
  "freind": "friend",
  "garantee": "guarantee",
  "garentee": "guarantee",
  "heigth": "height",
  "hierarcy": "hierarchy",
  "immediatly": "immediately",
  "independant": "independent",
  "independance": "independence",
  "interupt": "interrupt",
  "judgement": "judgment",
  "knowlege": "knowledge",
  "liase": "liaise",
  "maintenence": "maintenance",
  "mischevious": "mischievous",
  "mischevous": "mischievous",
  "noticable": "noticeable",
  "ocassion": "occasion",
  "occasionaly": "occasionally",
  "opiniom": "opinion",
  "paralel": "parallel",
  "parralel": "parallel",
  "percieve": "perceive",
  "posession": "possession",
  "prefered": "preferred",
  "privelege": "privilege",
  "publically": "publicly",
  "realise": "realize",
  "realy": "really",
  "releive": "relieve",
  "religous": "religious",
  "rememberance": "remembrance",
  "rythm": "rhythm",
  "sheild": "shield",
  "similiar": "similar",
  "sence": "sense",
  "threshhold": "threshold",
  "twelth": "twelfth",
  "unforseen": "unforeseen",
  "viscious": "vicious",
  "wether": "whether",
  "whereever": "wherever",
  "yesturday": "yesterday",
};

// Check if a word is capitalized (candidate for proper noun)
export function isCapitalized(word: string): boolean {
  return /^[A-Z][a-z]*$/.test(word);
}

// Checks if the word is at the start of a sentence in the given text
export function isStartOfSentence(text: string, wordIndex: number): boolean {
  if (wordIndex <= 0) return true;
  
  // Look backwards from the word start to find the last non-whitespace character
  const precedingText = text.substring(0, wordIndex).trim();
  if (precedingText.length === 0) return true;
  
  const lastChar = precedingText[precedingText.length - 1];
  // If preceding character is sentence terminal, it's the start of a new sentence
  return ['.', '?', '!', '\n'].includes(lastChar);
}

/**
 * Checks if the last typed word should be autocorrected.
 * Returns the replacement and undo metadata if applicable, else null.
 */
export function checkAutocorrect(
  text: string,
  cursorPos: number
): { original: string; corrected: string; index: number; textAfterCorrection: string } | null {
  // Autocorrect is triggered when space or punctuation is entered
  if (cursorPos <= 1) return null;
  
  const lastChar = text[cursorPos - 1];
  const isBoundary = /[\s,.;!?]/.test(lastChar);
  if (!isBoundary) return null;
  
  // Find the boundaries of the word immediately before this cursor position
  let wordEnd = cursorPos - 1;
  while (wordEnd > 0 && /[\s,.;!?]/.test(text[wordEnd - 1])) {
    wordEnd--;
  }
  
  let wordStart = wordEnd;
  while (wordStart > 0 && !/[\s,.;!?]/.test(text[wordStart - 1])) {
    wordStart--;
  }
  
  const word = text.substring(wordStart, wordEnd);
  if (!word || word.length < 2) return null;
  
  const lowerWord = word.toLowerCase();
  
  // If the word isn't a known typo, skip
  if (!TYPO_MAP[lowerWord]) return null;
  
  // Proper nouns exception:
  // Capitalized words in the middle of sentences are ignored
  const isCap = isCapitalized(word);
  const isStart = isStartOfSentence(text, wordStart);
  
  if (isCap && !isStart) {
    // Middle-of-sentence capitalized word, likely a proper noun. Skip.
    return null;
  }
  
  // Retrieve the corrected version
  let replacement = TYPO_MAP[lowerWord];
  
  // Maintain capitalization style if it was capitalized at the start of a sentence
  if (isCap) {
    replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  
  // Perform replacement in the text
  const before = text.substring(0, wordStart);
  const after = text.substring(wordEnd);
  const textAfterCorrection = before + replacement + after;
  
  return {
    original: word,
    corrected: replacement,
    index: wordStart,
    textAfterCorrection,
  };
}
