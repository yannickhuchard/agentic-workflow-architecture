"""
ISO 8601 durations, in the subset AWA allows (specification 13.5):
weeks, days, hours, minutes and seconds. Years and months have no fixed
length and are rejected.
"""

import re

_DURATION = re.compile(r"^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$")


def parse_iso_duration(duration: str) -> float:
    """Parse an ISO 8601 duration into milliseconds. Raises ValueError for anything else."""
    match = _DURATION.match(duration) if isinstance(duration, str) else None
    if not match or duration in ("P", "PT"):
        raise ValueError(f'Unsupported duration "{duration}": use weeks, days, hours, minutes and seconds')
    weeks, days, hours, minutes, seconds = (float(part or 0) for part in match.groups())
    return ((weeks * 7 + days) * 24 * 3600 + hours * 3600 + minutes * 60 + seconds) * 1000
