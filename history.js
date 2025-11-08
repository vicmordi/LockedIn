function loadHistory(){ try{return JSON.parse(localStorage.getItem('li_history')||'[]');}catch(_){return [];} }
function saveHistory(list){ localStorage.setItem('li_history', JSON.stringify(list.slice(-200))); }

const historyDiv = document.getElementById('history');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');

function render(){
  const list = loadHistory().slice().reverse();
  historyDiv.innerHTML = list.length
    ? list.map(i=>{
        const desc = i.description ? `<div class="muted" style="margin-top:4px">${escapeHtml(i.description)}</div>` : '';
        return `<div class="hrow" style="flex-direction:column; align-items:flex-start">
          <span>${new Date(i.date).toLocaleString()} — ${i.minutes}m — ${i.label||'Focus'} <span class="${i.outcome==='Completed'?'ok':'bad'}" style="margin-left:6px">${i.outcome}</span></span>
          ${desc}
        </div>`;
      }).join('')
    : `<div class="muted">No sessions yet.</div>`;
}
function exportCSV(){
  const rows = [['Date','Minutes','Outcome','Label','Description']];
  loadHistory().forEach(i=> rows.push([i.date, i.minutes, i.outcome, i.label||'', (i.description||'')]));
  const csv = rows.map(r=> r.map(v=> `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'lockedin_history.csv'; a.click();
  URL.revokeObjectURL(url);
}
function clearHistory(){
  if(confirm('Clear all history? This cannot be undone.')){
    saveHistory([]);
    render();
  }
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

exportBtn.addEventListener('click', exportCSV);
clearBtn.addEventListener('click', clearHistory);
render();
