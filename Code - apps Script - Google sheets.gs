// ═══════════════════════════════════════════════════
// BingX Trading Journal — Google Apps Script
// ĐÃ CẬP NHẬT: Đọc đúng sheet thực tế BingX_Trading_T6-2026
// ═══════════════════════════════════════════════════

// ⚠️ ĐỔI TÊN SHEET NÀY NẾU CẦN — phải khớp với tab sheet của bạn
const SHEET_NAME = 'BingX_Trading_T6-2026';

function doPost(e) {
  try {
    let data;
    // Apps Script tự decode application/x-www-form-urlencoded vào e.parameter
    if (e.parameter && e.parameter.payload) {
      data = JSON.parse(e.parameter.payload);
    } else if (e.postData && e.postData.contents) {
      // Fallback: raw JSON body
      data = JSON.parse(e.postData.contents);
    } else if (e.parameter && e.parameter.action) {
      data = e.parameter;
    } else {
      return respond({ success: false, error: 'No data received' });
    }

    const action = data.action;
    if (action === 'addTrade')      return addTrade(data.trade);
    if (action === 'batchAddTrades') return batchAddTrades(data.trades);
    if (action === 'deleteTrade')   return deleteTrade(data.id);
    if (action === 'getAllTrades')  return getAllTrades();
    return respond({ success: false, error: 'Unknown action: ' + action });
  } catch(err) {
    return respond({ success: false, error: err.message });
  }
}

function doGet(e) {
  const action = e.parameter.action;
  if (action === 'getAllTrades') return getAllTrades();
  // Fallback: hỗ trợ write action qua GET với payload JSON trong query (?action=addTrade&payload=...)
  if (e.parameter.payload) {
    try {
      const data = JSON.parse(e.parameter.payload);
      if (action === 'addTrade')      return addTrade(data.trade);
      if (action === 'batchAddTrades') return batchAddTrades(data.trades);
      if (action === 'deleteTrade')   return deleteTrade(data.id);
    } catch(err) {
      return respond({ success: false, error: err.message });
    }
  }
  return respond({ success: false, error: 'Use POST for write operations' });
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ════════════════════════════════════════
// TÌM SHEET DỮ LIỆU GIAO DỊCH (dùng chung cho mọi action)
// Thử theo tên SHEET_NAME, nếu không có thì tự dò sheet có cột Coin/Ngày
// ════════════════════════════════════════
function findTradeSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (sheet) return sheet;

  const sheets = ss.getSheets();
  for (const s of sheets) {
    const vals = s.getDataRange().getValues();
    for (let r = 0; r < Math.min(vals.length, 6); r++) {
      const rowStr = vals[r].join('|').toLowerCase();
      if (rowStr.includes('coin') && rowStr.includes('ng')) {
        return s;
      }
    }
  }
  return null;
}

// ════════════════════════════════════════
// ĐỌC DỮ LIỆU — tự động tìm dòng header thực
// Sheet của bạn: Row1=tiêu đề lớn, Row2=subtitle,
// Row3=nhóm cột, Row4=tên cột thực, Row5+=data
// ════════════════════════════════════════
function getAllTrades() {
  const sheet = findTradeSheet();
  if (!sheet) return respond({ success: false, error: 'Không tìm thấy sheet dữ liệu' });

  const allData = sheet.getDataRange().getValues();
  
  // Tìm dòng header thực: dòng có chứa 'Coin' hoặc 'coin'
  let headerRow = -1;
  for (let r = 0; r < allData.length; r++) {
    const rowJoined = allData[r].map(c => String(c).trim().toLowerCase()).join('|');
    if (rowJoined.includes('coin') && (rowJoined.includes('ng') || rowJoined.includes('date'))) {
      headerRow = r;
      break;
    }
  }
  if (headerRow === -1) return respond({ success: false, error: 'Không tìm thấy dòng header' });

  const headers = allData[headerRow].map(h => String(h).trim());
  
  // Hàm tìm index cột theo tên (fuzzy)
  function col(names) {
    for (const name of names) {
      const idx = headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));
      if (idx !== -1) return idx;
    }
    return -1;
  }

  // Map index các cột quan trọng
  const iSTT    = col(['STT', 'stt', '#']);
  const iDate   = col(['Ngày', 'date', 'Date']);
  const iCoin   = col(['Coin', 'coin']);
  const iSide   = col(['Hướng', 'Side', 'side', 'huong']);
  const iLev    = col(['Đòn bẩy', 'don bay', 'Leverage', 'lev']);
  const iEntry  = col(['Giá vào', 'gia vao', 'Entry', 'entry']);
  const iTP     = col(['Take Profit', 'tp', 'TP']);
  const iSL     = col(['Stop Loss', 'sl', 'SL']);
  const iVon    = col(['Vốn (USDT)', 'Margin thực', 'margin', 'Margin', 'von']);
  const iRR     = col(['R:R', 'rr', 'RR']);
  const iStatus = col(['Trạng thái', 'status', 'Status', 'trang thai']);
  const iClose  = col(['Giá đóng', 'gia dong', 'close', 'Close']);
  const iPct    = col(['% P&L', '%P&L', 'pct', '% P']);
  const iPnL    = col(['Lãi/Lỗ (USDT)', 'pnl', 'PnL', 'P&L (USDT)', 'lai lo']);
  const iEmo    = col(['Cảm xúc', 'emotion', 'cam xuc']);
  const iNote   = col(['Ghi chú', 'note', 'Note', 'ghi chu']);

  // Chuyển ngày DD/MM/YYYY → YYYY-MM-DD
  function parseDate(v) {
    const s = String(v).trim();
    // Google Sheets Date object
    if (v instanceof Date) {
      const y = v.getFullYear(), m = String(v.getMonth()+1).padStart(2,'0'), d = String(v.getDate()).padStart(2,'0');
      return y + '-' + m + '-' + d;
    }
    const dmY = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (dmY) return dmY[3] + '-' + dmY[2].padStart(2,'0') + '-' + dmY[1].padStart(2,'0');
    return s;
  }

  function get(row, idx) { return idx >= 0 ? row[idx] : ''; }
  function getNum(row, idx) {
    if (idx < 0) return 0;
    const v = row[idx];
    if (v === '' || v === null || v === undefined) return 0;
    return parseFloat(String(v).replace(/[^0-9.\-]/g, '')) || 0;
  }

  const trades = [];
  let autoId = 1;

  for (let r = headerRow + 1; r < allData.length; r++) {
    const row = allData[r];
    
    // Bỏ dòng trống
    const dateVal = get(row, iDate);
    const coinVal = String(get(row, iCoin)).trim();
    if (!dateVal || !coinVal || coinVal === '') continue;
    
    // Bỏ dòng tổng kết cuối (có chữ "Tổng" hoặc "Total")
    if (coinVal.toLowerCase().includes('t') && coinVal.length > 6) continue;

    const date = parseDate(dateVal);
    if (!date || date.length < 8) continue;

    let side = String(get(row, iSide)).trim().toUpperCase();
    side = side.includes('SHORT') ? 'SHORT' : 'LONG';

    // id: dùng STT nếu có, không thì autoId
    const sttVal = parseInt(get(row, iSTT));
    const id = (!isNaN(sttVal) && sttVal > 0) ? sttVal : autoId;
    autoId++;

    // P&L: ưu tiên cột Lãi/Lỗ USDT, fallback % P&L
    let pnl = getNum(row, iPnL);

    // Trạng thái
    let status = String(get(row, iStatus)).trim().toUpperCase();
    if (!['WIN','LOSS','BE','OPEN'].some(s => status.includes(s))) {
      status = 'OPEN';
    } else {
      status = ['WIN','LOSS','BE','OPEN'].find(s => status.includes(s)) || 'OPEN';
    }

    trades.push({
      id,
      date,
      coin: coinVal,
      side,
      lev:    getNum(row, iLev),
      entry:  getNum(row, iEntry),
      sl:     getNum(row, iSL),
      tp:     getNum(row, iTP),
      slPct:  0,
      tpPct:  0,
      rr:     getNum(row, iRR),
      margin: getNum(row, iVon),
      close:  getNum(row, iClose),
      pnl,
      status,
      emotion: String(get(row, iEmo)).trim(),
      note:    String(get(row, iNote)).trim()
    });
  }

  return respond({ success: true, trades });
}

// ════════════════════════════════════════
// CHUYỂN ĐỔI trade (từ web) → 1 dòng theo đúng cấu trúc 20 cột của Sheet:
// A=STT B=Ngày C=Coin D=Hướng E=Đòn bẩy F=Giá vào G=Take Profit H=Stop Loss
// I=Vốn(USDT) J=Margin thực K=R:R L=%TP/%SL M=Trạng thái N=Giá đóng
// O=%P&L P=Lãi/Lỗ(USDT) Q=Phiên R=Chiến lược S=Cảm xúc T=Ghi chú
// ════════════════════════════════════════
function tradeToRow(trade) {
  const margin = trade.margin || 0;
  const lev = trade.lev || 0;
  const marginThuc = margin * lev;
  const tpPct = trade.tpPct || 0;
  const slPct = trade.slPct || 0;
  const pctSLTP = (tpPct || slPct) ? (tpPct + '% / ' + Math.abs(slPct) + '%') : '';
  const pnl = trade.pnl || 0;
  const pctPnL = margin ? +((pnl / margin) * 100).toFixed(2) : 0;

  return [
    trade.id, trade.date, trade.coin, trade.side,
    lev, trade.entry, trade.tp, trade.sl,
    margin, marginThuc, trade.rr || '',
    pctSLTP, trade.status, trade.close || '',
    pctPnL, pnl,
    '', '', trade.emotion || '', trade.note || ''
  ];
}

// ════════════════════════════════════════
// TÌM DÒNG DỮ LIỆU CUỐI THỰC SỰ — dựa vào cột A (STT), không dùng getLastRow()
// vì getLastRow() có thể trả về dòng có định dạng/border trống xa hơn dữ liệu thật
// ════════════════════════════════════════
function findLastDataRow(sheet) {
  const maxRow = sheet.getMaxRows();
  const colA = sheet.getRange(1, 1, maxRow, 1).getValues();
  for (let r = colA.length - 1; r >= 0; r--) {
    const v = colA[r][0];
    if (v !== '' && v !== null && v !== undefined) return r + 1; // 1-indexed
  }
  // Không có dữ liệu — fallback: header ở dòng 4, dữ liệu bắt đầu dòng 5
  return 4;
}

// ════════════════════════════════════════
// THÊM LỆNH MỚI — ghi vào cuối sheet (sau dòng dữ liệu cuối)
// ════════════════════════════════════════
function addTrade(trade) {
  const sheet = findTradeSheet();
  if (!sheet) return respond({ success: false, error: 'Không tìm thấy sheet dữ liệu' });

  const row = tradeToRow(trade);

  // Tìm dòng dữ liệu cuối thực sự (dựa vào cột STT)
  const lastRow = findLastDataRow(sheet);
  sheet.getRange(lastRow + 1, 1, 1, row.length).setValues([row]);

  // Màu P&L (cột P = Lãi/Lỗ (USDT) = cột 16)
  const pnl = trade.pnl || 0;
  sheet.getRange(lastRow + 1, 16)
    .setFontColor(pnl >= 0 ? '#059669' : '#dc2626')
    .setFontWeight('bold');

  return respond({ success: true, row: lastRow + 1 });
}

// ════════════════════════════════════════
// THÊM NHIỀU LỆNH 1 LẦN — nhanh hơn nhiều so với gọi addTrade lặp lại
// ════════════════════════════════════════
function batchAddTrades(trades) {
  const sheet = findTradeSheet();
  if (!sheet) return respond({ success: false, error: 'Không tìm thấy sheet dữ liệu' });
  if (!trades || !trades.length) return respond({ success: true, added: 0 });

  // Kiểm tra dữ liệu hợp lệ trước khi ghi
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    if (!t || t.date === undefined || t.coin === undefined) {
      return respond({ success: false, error: 'Dữ liệu trade[' + i + '] không hợp lệ: ' + JSON.stringify(t) });
    }
  }

  const rows = trades.map(trade => tradeToRow(trade));

  const lastRow = findLastDataRow(sheet);
  sheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);

  // Màu P&L cho từng dòng (cột P = Lãi/Lỗ (USDT) = cột 16)
  for (let i = 0; i < trades.length; i++) {
    const pnl = trades[i].pnl || 0;
    sheet.getRange(lastRow + 1 + i, 16)
      .setFontColor(pnl >= 0 ? '#059669' : '#dc2626')
      .setFontWeight('bold');
  }

  return respond({ success: true, added: rows.length });
}

// ════════════════════════════════════════
// XOÁ LỆNH theo ID
// ════════════════════════════════════════
function deleteTrade(id) {
  const sheet = findTradeSheet();
  if (!sheet) return respond({ success: false, error: 'Không tìm thấy sheet dữ liệu' });

  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return respond({ success: true });
    }
  }
  return respond({ success: false, error: 'Không tìm thấy lệnh ID: ' + id });
}
