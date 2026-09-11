# Decisions needed

Append-only. A build session that hits a §4.4 stop writes its question here
(phase id, date, the question, the options it sees), commits, pushes, and
ends. The watcher notifies Anton; Anton answers in place, or edits the
relevant prompt file on main. Answered entries stay for the record.

_No open entries._
