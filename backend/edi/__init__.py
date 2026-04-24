"""
EDI module for X12 claim generation and parsing.

Supports:
- 837P: Professional claim file generation (HIPAA 5010)
- 835: Electronic Remittance Advice (ERA) parsing
"""

from .x12_837p import X12837PGenerator, generate_837p
from .x12_835 import X12835Parser, parse_835

__all__ = [
    "X12837PGenerator",
    "generate_837p",
    "X12835Parser",
    "parse_835",
]
