/* Special characters for the editor: the dialog's categories (Unicode ranges) and a LaTeX command → character table,
   used by the dialog's search and by the inline \command shortcuts. Editor only; decks never load it. */
(() => {
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i));
  const pick = s => [...s];
  const CHAR_CATEGORIES = [
    ['Math operators', [...pick('±×÷−∓∘∙√∛∜∝∞∟∠∡∢∣∤∥∦∧∨∩∪∫∬∭∮∴∵∶∷∼≀≃≅≈≉≍≐≠≡≢≤≥≦≧≪≫≺≻⊂⊃⊄⊅⊆⊇⊊⊋⊕⊖⊗⊘⊙⊢⊣⊤⊥⊨⋀⋁⋂⋃⋅⋆⋮⋯⋰⋱'), ...range(0x2200, 0x22ff)]],
    ['Arrows', [...range(0x2190, 0x21ff), ...range(0x27f0, 0x27ff), ...range(0x2900, 0x297f)]],
    ['Greek', [...range(0x391, 0x3a1), ...range(0x3a3, 0x3a9), ...range(0x3b1, 0x3c9), ...pick('ϑϕϖϵϱς')]],
    ['Sub/superscripts', [...pick('⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₔₕₖₗₘₙₚₛₜ')]],
    ['Currency', [...pick('$¢£¤¥'), ...range(0x20a0, 0x20c0)]],
    ['Letterlike', [...range(0x2100, 0x214f)]],
    ['Box drawing', [...range(0x2500, 0x259f)]],
    ['Shapes', [...range(0x25a0, 0x25ff)]],
    ['Emoji', [...range(0x1f600, 0x1f64f), ...range(0x1f44d, 0x1f44e), ...pick('✅❌⭐🔥💡📈📉📊🎯🚀⚠️')]],
  ].map(([name, chars]) => [name, [...new Set(chars)]]);

  const LATEX = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
    iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ',
    varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮', partial: '∂', nabla: '∇', infty: '∞',
    sqrt: '√', pm: '±', mp: '∓', times: '×', div: '÷', cdot: '⋅', cdots: '⋯', ldots: '…', vdots: '⋮', ddots: '⋱', circ: '∘',
    bullet: '∙', star: '⋆', ast: '∗', oplus: '⊕', ominus: '⊖', otimes: '⊗', oslash: '⊘', odot: '⊙',
    leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅',
    propto: '∝', ll: '≪', gg: '≫', prec: '≺', succ: '≻', doteq: '≐', models: '⊨', vdash: '⊢', dashv: '⊣', perp: '⊥', parallel: '∥', mid: '∣',
    in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', cap: '∩', cup: '∪', setminus: '∖',
    emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', nexists: '∄', neg: '¬', lnot: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨',
    therefore: '∴', because: '∵', angle: '∠', top: '⊤', bot: '⊥', aleph: 'ℵ', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', wp: '℘',
    mathbb_R: 'ℝ', mathbb_N: 'ℕ', mathbb_Z: 'ℤ', mathbb_Q: 'ℚ', mathbb_C: 'ℂ', degree: '°', prime: '′', dagger: '†', ddagger: '‡',
    leftarrow: '←', gets: '←', rightarrow: '→', to: '→', uparrow: '↑', downarrow: '↓', leftrightarrow: '↔', updownarrow: '↕',
    Leftarrow: '⇐', Rightarrow: '⇒', Uparrow: '⇑', Downarrow: '⇓', Leftrightarrow: '⇔', iff: '⟺', implies: '⟹', impliedby: '⟸',
    mapsto: '↦', longrightarrow: '⟶', longleftarrow: '⟵', longmapsto: '⟼', hookrightarrow: '↪', hookleftarrow: '↩',
    nearrow: '↗', searrow: '↘', swarrow: '↙', nwarrow: '↖', rightleftharpoons: '⇌', leftharpoonup: '↼', rightharpoonup: '⇀',
    langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', checkmark: '✓', square: '□', blacksquare: '■',
    triangle: '△', diamond: '◇', clubsuit: '♣', heartsuit: '♡', spadesuit: '♠', diamondsuit: '♢', flat: '♭', sharp: '♯', natural: '♮',
    euro: '€', pounds: '£', yen: '¥', cent: '¢', copyright: '©', registered: '®', trademark: '™', S: '§', P: '¶',
  };
  window.CHAR_CATEGORIES = CHAR_CATEGORIES;
  window.LATEX_SYMBOLS = Object.fromEntries(Object.entries(LATEX).map(([k, v]) => [k.replace('mathbb_', 'mathbb'), v]));
})();
