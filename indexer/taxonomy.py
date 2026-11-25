"""Subjects as arXiv codes (math.NT, cs.AI, quant-ph, …).

A record's subject comes from an arXiv code the source gives, else the source's subject name mapped
below, else the labelling model.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

# Divisions, in display order. A code belongs to the first division whose prefixes match it.
DIVISIONS = [
    ("math", "Mathematics", ("math",)),
    ("cs", "Computer Science", ("cs",)),
    ("physics", "Physics", ("astro-ph", "cond-mat", "gr-qc", "hep", "math-ph", "nlin", "nucl", "physics", "quant-ph")),
    ("q-bio", "Quantitative Biology", ("q-bio",)),
    ("stat", "Statistics", ("stat",)),
    ("eess", "Electrical Engineering and Systems Science", ("eess",)),
    ("econ", "Economics", ("econ", "q-fin")),
    ("other", "Other", ("other",)),
]

NAMES = {
    # Mathematics
    "math.AC": "Commutative Algebra", "math.AG": "Algebraic Geometry", "math.AP": "Analysis of PDEs", "math.AT": "Algebraic Topology",
    "math.CA": "Classical Analysis and ODEs", "math.CO": "Combinatorics", "math.CT": "Category Theory", "math.CV": "Complex Variables",
    "math.DG": "Differential Geometry", "math.DS": "Dynamical Systems", "math.FA": "Functional Analysis", "math.GM": "General Mathematics",
    "math.GN": "General Topology", "math.GR": "Group Theory", "math.GT": "Geometric Topology", "math.HO": "History and Overview",
    "math.IT": "Information Theory", "math.KT": "K-Theory and Homology", "math.LO": "Logic", "math.MG": "Metric Geometry",
    "math.MP": "Mathematical Physics", "math.NA": "Numerical Analysis", "math.NT": "Number Theory", "math.OA": "Operator Algebras",
    "math.OC": "Optimization and Control", "math.PR": "Probability", "math.QA": "Quantum Algebra", "math.RA": "Rings and Algebras",
    "math.RT": "Representation Theory", "math.SG": "Symplectic Geometry", "math.SP": "Spectral Theory", "math.ST": "Statistics Theory",
    # Computer Science
    "cs.AI": "Artificial Intelligence", "cs.CC": "Computational Complexity", "cs.CG": "Computational Geometry", "cs.CL": "Computation and Language",
    "cs.CR": "Cryptography and Security", "cs.CV": "Computer Vision", "cs.CY": "Computers and Society", "cs.DB": "Databases",
    "cs.DC": "Distributed Computing", "cs.DL": "Digital Libraries", "cs.DM": "Discrete Mathematics", "cs.DS": "Data Structures and Algorithms",
    "cs.FL": "Formal Languages", "cs.GT": "Game Theory", "cs.HC": "Human-Computer Interaction", "cs.IR": "Information Retrieval",
    "cs.IT": "Information Theory", "cs.LG": "Machine Learning", "cs.LO": "Logic in Computer Science", "cs.MA": "Multiagent Systems",
    "cs.NE": "Neural and Evolutionary Computing", "cs.PL": "Programming Languages", "cs.RO": "Robotics", "cs.SE": "Software Engineering",
    "cs.SY": "Systems and Control",
    # Physics
    "astro-ph": "Astrophysics", "astro-ph.CO": "Cosmology", "cond-mat": "Condensed Matter", "cond-mat.stat-mech": "Statistical Mechanics",
    "cond-mat.str-el": "Strongly Correlated Electrons", "gr-qc": "General Relativity and Quantum Cosmology", "hep-ph": "High Energy Physics – Phenomenology",
    "hep-th": "High Energy Physics – Theory", "math-ph": "Mathematical Physics", "nlin": "Nonlinear Sciences", "nucl-th": "Nuclear Theory",
    "physics": "General Physics", "physics.chem-ph": "Chemical Physics", "physics.class-ph": "Classical Physics", "physics.hist-ph": "History and Philosophy of Physics",
    "physics.ao-ph": "Atmospheric and Oceanic Physics", "physics.ed-ph": "Physics Education", "physics.bio-ph": "Biological Physics",
    "quant-ph": "Quantum Physics",
    # Others
    "q-bio": "Quantitative Biology", "q-bio.BM": "Biomolecules", "q-bio.NC": "Neurons and Cognition", "q-bio.GN": "Genomics",
    "q-bio.QM": "Quantitative Methods", "stat": "Statistics", "stat.ML": "Machine Learning (Statistics)", "stat.ME": "Methodology",
    "eess": "Electrical Engineering", "eess.SP": "Signal Processing", "econ": "Economics", "econ.GN": "General Economics", "q-fin": "Quantitative Finance",
    "other": "Other", "other.soc": "Social Sciences and Humanities",
}

# Subject names that sources use, mapped to codes (OpenAI Math disciplines, ai.viXra categories, APP domains).
FROM_NAME = {
    "number theory": "math.NT", "algebraic and complex geometry": "math.AG", "real and complex analysis": "math.CA",
    "convex and metric geometry": "math.MG", "theoretical computer science": "cs.CC", "dynamical systems and ergodic theory": "math.DS",
    "combinatorics": "math.CO", "algebra": "math.RA", "probability and statistical mechanics": "math.PR", "mathematical logic": "math.LO",
    "group theory": "math.GR", "mathematical physics": "math.MP", "operator algebras": "math.OA", "topology": "math.GT",
    "functional analysis": "math.FA", "differential geometry": "math.DG", "partial differential equations": "math.AP",
    "relativity and cosmology": "gr-qc", "quantum physics": "quant-ph", "quantum gravity and string theory": "hep-th",
    "artificial intelligence": "cs.AI", "quantitative biology": "q-bio", "geometry": "math.MG", "astrophysics": "astro-ph",
    "statistics": "stat", "social science": "other.soc", "general mathematics": "math.GM", "condensed matter": "cond-mat",
    "high energy particle physics": "hep-ph", "classical physics": "physics.class-ph", "data structures and algorithms": "cs.DS",
    "digital signal processing": "eess.SP", "economics and finance": "econ.GN", "chemistry": "physics.chem-ph", "biochemistry": "q-bio.BM",
    "climate research": "physics.ao-ph", "education and didactics": "physics.ed-ph", "history and philosophy of physics": "physics.hist-ph",
    "thermodynamics and energy": "physics.class-ph", "nuclear and atomic physics": "nucl-th", "functions and analysis": "math.CA",
    "set theory and logic": "math.LO", "mind science": "q-bio.NC", "linguistics": "cs.CL", "physics of biology": "physics.bio-ph",
    "high-energy-theory": "hep-th", "quantum-information": "quant-ph", "condensed-matter-physics": "cond-mat",
    "condensed-matter physics": "cond-mat", "mechanistic-interpretability": "cs.LG", "scientific-publication": "cs.DL",
}

# Mathematics Subject Classification areas (two digits) that sources tag problems with, mapped to codes.
FROM_MSC = {
    3: "math.LO", 5: "math.CO", 11: "math.NT", 13: "math.AC", 14: "math.AG", 15: "math.RA", 16: "math.RA", 17: "math.RA", 18: "math.CT",
    19: "math.KT", 20: "math.GR", 26: "math.CA", 28: "math.CA", 30: "math.CV", 32: "math.CV", 33: "math.CA", 34: "math.CA", 35: "math.AP",
    37: "math.DS", 40: "math.CA", 41: "math.CA", 42: "math.CA", 46: "math.FA", 47: "math.FA", 49: "math.OC", 51: "math.MG", 52: "math.MG",
    53: "math.DG", 54: "math.GN", 55: "math.AT", 57: "math.GT", 60: "math.PR", 62: "math.ST", 65: "math.NA", 81: "quant-ph", 83: "gr-qc",
    90: "math.OC", 94: "math.IT",
}

CODE = re.compile(r"^(?:[a-z]+(?:-[a-z]+)?)(?:\.[A-Za-z-]+)?$")
# The site's search (site/lib/records/query.ts) reads these rules from this file.
JSON_PATH = Path(__file__).resolve().parent.parent / "site" / "lib" / "records" / "taxonomy.json"


def division_of(code: str) -> str:
    for key, _, prefixes in DIVISIONS:
        if any(code == p or code.startswith(p + ".") or code.startswith(p + "-") for p in prefixes):
            return key
    return "other"


def is_code(c: str) -> bool:
    """A subject code we know: listed by name, or under one of the divisions (math.XX, hep-th, …)."""
    return bool(c) and bool(CODE.match(c)) and (c in NAMES or division_of(c) != "other")


def subject_of(domain: str | None, agent_subject: str | None = None) -> str:
    """The record's subject code, or '' if neither the source nor the agent gave one."""
    d = (domain or "").strip()
    if is_code(d):
        return d
    if d.lower() in FROM_NAME:
        return FROM_NAME[d.lower()]
    a = (agent_subject or "").strip()
    return a if is_code(a) else ""


def as_json() -> dict:
    return {"divisions": [{"key": k, "name": n, "prefixes": list(p)} for k, n, p in DIVISIONS], "names": NAMES, "from_name": FROM_NAME}


def write_json() -> None:
    """Writes the rules for the site's cat: search (site/lib/records/query.ts), if they changed."""
    text = json.dumps(as_json(), indent=1, ensure_ascii=False) + "\n"
    if not JSON_PATH.exists() or JSON_PATH.read_text() != text:
        JSON_PATH.write_text(text)
