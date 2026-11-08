import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { getDb } from '@/lib/mongodb';
import { calculateBalancesThrough as balanceThrough } from '@/lib/finance/balances';
import { BUSINESS_ID, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_VENDORS, MONTHS } from '@/lib/constants';
import type { BusinessSettings, DailyEntry, FinanceLoan, FinanceMonth, PurchaseEntry, VendorDefectReturn } from '@/types/domain';

type ReconciliationExport = {
  date: string;
  bookOnline: number;
  bookCash: number;
  actualOnline: number;
  actualCash: number;
  varianceOnline: number;
  varianceCash: number;
};
type AdditionalFinanceData = {
  months?: FinanceMonth[];
  loans?: FinanceLoan[];
  vendorReturns?: VendorDefectReturn[];
  reconciliations?: ReconciliationExport[];
};
type FinanceSheetRow = { type: string; dateOrPeriod: string | number; paymentDate?: string; name: string; source: string; amount: number; received: number; outstanding: number; notes: string; recordId: string; paidOnline?: number; paidCash?: number };

function excelSerial(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Math.floor((d.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
}
function esc(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
function cellNum(ref: string, value: number | null, style?: string) { return value === null ? '' : `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`; }
function cellText(ref: string, value: string, style?: string) { return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t>${esc(value)}</t></is></c>`; }
function cellFormula(ref: string, formula: string, cachedValue?: number, style?: string) { return `<c r="${ref}"${style ? ` s="${style}"` : ''}><f>${esc(formula)}</f>${cachedValue === undefined ? '' : `<v>${cachedValue}</v>`}</c>`; }
function excelColumn(index: number) { let value = index + 1, result = ''; while (value > 0) { const remainder = (value - 1) % 26; result = String.fromCharCode(65 + remainder) + result; value = Math.floor((value - 1) / 26); } return result; }
function columnIndex(column: string) { return [...column].reduce((total,char)=>total*26+char.charCodeAt(0)-64,0); }
function settingsSlots(xml:string){
  const rows=[...xml.matchAll(/<c\b[^>]*\br="([AC])(\d+)"/g)].map(match=>({column:match[1],row:Number(match[2])}));
  return {vendors:Math.max(0,...rows.filter(cell=>cell.column==='A').map(cell=>cell.row-6)),expenses:Math.max(0,...rows.filter(cell=>cell.column==='C').map(cell=>cell.row-6))};
}
function setWorksheetCell(xml: string, ref: string, markup: string) {
  const escapedRef=ref.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const cellPattern=new RegExp(`<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`);
  if(cellPattern.test(xml)) return xml.replace(cellPattern,()=>markup);
  const match=/^([A-Z]+)(\d+)$/.exec(ref);
  if(!match) return xml;
  const rowNumber=Number(match[2]),targetColumn=columnIndex(match[1]);
  const rowPattern=new RegExp(`(<row\\b(?=[^>]*\\br="${rowNumber}")[^>]*>)([\\s\\S]*?)<\\/row>`);
  const rowMatch=rowPattern.exec(xml);
  if(rowMatch){
    const content=rowMatch[2];
    const cellPatternInRow=/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g;
    let insertion=content.length,cellMatch:RegExpExecArray|null;
    while((cellMatch=cellPatternInRow.exec(content))){if(columnIndex(cellMatch[1])>targetColumn){insertion=cellMatch.index;break;}}
    const newRow=`${rowMatch[1]}${content.slice(0,insertion)}${markup}${content.slice(insertion)}</row>`;
    return xml.replace(rowPattern,()=>newRow);
  }
  const newRow=`<row r="${rowNumber}">${markup}</row>`;
  const sheetDataEnd=xml.indexOf('</sheetData>');
  if(sheetDataEnd<0) return xml;
  const prefix=xml.slice(0,sheetDataEnd),rowTags=[...prefix.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>/g)];
  const laterRow=rowTags.find(row=>Number(row[1])>rowNumber);
  return laterRow?xml.slice(0,laterRow.index)+newRow+xml.slice(laterRow.index):xml.slice(0,sheetDataEnd)+newRow+xml.slice(sheetDataEnd);
}
function setFormulaCell(xml:string,ref:string,formula:string,cachedValue=0){
  const escapedRef=ref.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp(`(<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*>)[\\s\\S]*?<\\/c>`);
  const match=pattern.exec(xml);
  return match?xml.replace(pattern,()=>`${match[1]}<f>${esc(formula)}</f><v>${cachedValue}</v></c>`):setWorksheetCell(xml,ref,cellFormula(ref,formula,cachedValue));
}
function setFormulaCache(xml:string,ref:string,value:number){
  const escapedRef=ref.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp(`<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*>[\\s\\S]*?<\\/c>`);
  return xml.replace(pattern,cell=>/<v\b[^>]*>[\s\S]*?<\/v>/.test(cell)?cell.replace(/<v\b[^>]*>[\s\S]*?<\/v>/,`<v>${value}</v>`):cell.replace('</c>',`<v>${value}</v></c>`));
}
function setCalcCachedText(xml:string,ref:string,value:string){
  const escapedRef=ref.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp(`(<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*)(>[\\s\\S]*?<\\/c>)`);
  const match=pattern.exec(xml);
  if(!match) return xml;
  const attributes=/\st="[^"]*"/.test(match[1])?match[1].replace(/\st="[^"]*"/,' t="str"'):`${match[1]} t="str"`;
  const body=/<v\b[^>]*>[\s\S]*?<\/v>/.test(match[2])?match[2].replace(/<v\b[^>]*>[\s\S]*?<\/v>/,`<v>${esc(value)}</v>`):match[2].replace('</c>',`<v>${esc(value)}</v></c>`);
  return xml.replace(pattern,()=>`${attributes}${body}`);
}
function setCellValue(xml:string,ref:string,value:string|number){
  const escapedRef=ref.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp(`(<c\\b(?=[^>]*\\br="${escapedRef}")[^>]*)(?:>[\\s\\S]*?<\\/c>|\\s*\\/>)`);
  const match=pattern.exec(xml);
  if(!match) return xml;
  const attributes=match[1].replace(/\s+t="[^"]*"/,'');
  const content=typeof value==='string'?` t="inlineStr"><is><t>${esc(value)}</t></is></c>`:`><v>${value}</v></c>`;
  return xml.replace(pattern,()=>`${attributes}${content}`);
}
function refreshChartCaches(xml:string,calcValues:Map<string,string|number>){
  return xml.replace(/<c:(numRef|strRef)>[\s\S]*?<\/c:\1>/g,reference=>{
    const formula=/<c:f>([\s\S]*?)<\/c:f>/.exec(reference)?.[1];
    const range=formula&&/^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(formula);
    if(!range) return reference;
    const [,sheet,firstColumn,firstRow,lastColumn,lastRow]=range;
    const startRow=Number(firstRow),endRow=Number(lastRow);
    const values:string[]=[];
    for(let row=startRow;row<=endRow;row++){
      const value=calcValues.get(`${sheet}!${firstColumn}${row}`) ?? calcValues.get(`${firstColumn}${row}`);
      if(value===undefined) return reference;
      values.push(String(value));
    }
    const cacheName=reference.startsWith('<c:numRef>')?'numCache':'strCache';
    const cachePattern=new RegExp(`<c:${cacheName}>[\\s\\S]*?<\\/c:${cacheName}>`);
    const oldCache=cachePattern.exec(reference)?.[0];
    if(!oldCache) return reference;
    const formatCode=/<c:formatCode>[\s\S]*?<\/c:formatCode>/.exec(oldCache)?.[0]||'';
    const points=values.map((value,index)=>`<c:pt idx="${index}"><c:v>${cacheName==='numCache'?value:esc(value)}</c:v></c:pt>`).join('');
    const cache=`<c:${cacheName}>${formatCode}<c:ptCount val="${values.length}"/>${points}</c:${cacheName}>`;
    return reference.replace(cachePattern,()=>cache);
  });
}
function updateTableXml(xml:string,headers:string[],lastColumn:string,lastRow:number){
  const used=new Set<string>();
  const columns=headers.map((header,index)=>{let name=header.trim()||`Unused Column ${index+1}`;while(used.has(name))name=`${name} ${index+1}`;used.add(name);return `<tableColumn id="${index+1}" name="${esc(name)}"/>`;}).join('');
  xml=xml.replace(/ref="A1:[A-Z]+\d+"/,`ref="A1:${lastColumn}${lastRow}"`);
  return xml.replace(/<tableColumns\b[^>]*>[\s\S]*?<\/tableColumns>/,`<tableColumns count="${headers.length}">${columns}</tableColumns>`);
}
function replaceWorksheetData(templateXml:string,generatedXml:string,minimumRows:number){
  const generatedData=/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/.exec(generatedXml)?.[0];
  if(!generatedData) throw new Error('Generated worksheet data is missing.');
  const existingDimension=/\<dimension\b[^>]*\bref="A1:([A-Z]+)(\d+)"[^>]*\/>/.exec(templateXml);
  const generatedDimension=/\<dimension\b[^>]*\bref="A1:([A-Z]+)(\d+)"[^>]*\/>/.exec(generatedXml);
  if(existingDimension&&generatedDimension){
    const lastColumn=excelColumn(Math.max(columnIndex(existingDimension[1]),columnIndex(generatedDimension[1]))-1);
    const lastRow=Math.max(Number(existingDimension[2]),Number(generatedDimension[2]),minimumRows);
    templateXml=templateXml.replace(existingDimension[0],`<dimension ref="A1:${lastColumn}${lastRow}"/>`);
  }
  const dataPattern=/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/;
  if(!dataPattern.test(templateXml)) throw new Error('Template worksheet data is missing.');
  return templateXml.replace(dataPattern,()=>generatedData);
}

function buildFinanceSheet(finance:AdditionalFinanceData){
  const records:FinanceSheetRow[]=[];
  for(const month of finance.months||[]){
    const period=month.period;
    const [year,monthNumber]=period.split('-').map(Number);
    const periodEnd=new Date(Date.UTC(year,monthNumber,0)).toISOString().slice(0,10);
    for(const salary of month.salaries||[]) records.push({type:'Salary',dateOrPeriod:period,paymentDate:salary.paymentDate||periodEnd,name:salary.person,source:'',amount:Number(salary.amount||0),received:0,outstanding:0,notes:'',recordId:'',paidOnline:Number(salary.paidOnline??salary.amount??0),paidCash:Number(salary.paidCash||0)});
    for(const [type,amount,paymentDate] of [
      ['Truck EMI',month.truckEmi,month.truckEmiPaymentDate||periodEnd],
      ['Auto EMI',month.autoEmi,month.autoEmiPaymentDate||periodEnd],
      ['Auto EMI Friend Share',month.autoEmiFriendShare||0,month.autoEmiPaymentDate||periodEnd],
      ['Room Rent',month.roomRent,month.roomRentPaymentDate||`${period}-01`],
      ['Savings Deposit',month.savingsDeposit,periodEnd]
    ] as const) records.push({type,dateOrPeriod:period,paymentDate,name:'',source:'',amount:Number(amount||0),received:0,outstanding:0,notes:'',recordId:''});
    for(const entry of month.savingsEntries||[]) records.push({type:'Dated Savings Deposit',dateOrPeriod:excelSerial(entry.date)||0,paymentDate:entry.date,name:'',source:'Savings',amount:Number(entry.amount||0),received:0,outstanding:0,notes:entry.note||'',recordId:''});
    for(const payment of month.partnerPayments||[]) records.push({type:'Partner Payout',dateOrPeriod:period,paymentDate:payment.paymentDate||periodEnd,name:payment.partner,source:'Savings',amount:Number(payment.amount||0),received:0,outstanding:0,notes:'Quarterly payout from savings',recordId:''});
  }
  for(const loan of finance.loans||[]){
    const id=String(loan._id||`${loan.person}-${loan.takenDate}`);
    const repaid=(loan.repayments||[]).reduce((sum,item)=>sum+Number(item.amount||0),0);
    records.push({type:'Loan Received',dateOrPeriod:loan.takenDate,name:loan.person,source:loan.source,amount:Number(loan.amountTaken||0),received:repaid,outstanding:Math.max(0,Number(loan.amountTaken||0)-repaid),notes:loan.notes||'',recordId:id});
    for(const repayment of loan.repayments||[]) records.push({type:'Loan Repayment',dateOrPeriod:excelSerial(repayment.date)||0,name:loan.person,source:loan.source,amount:Number(repayment.amount||0),received:0,outstanding:0,notes:'',recordId:id});
  }
  for(const credit of finance.vendorReturns||[]){
    const id=String(credit._id||`${credit.vendor}-${credit.returnDate}`);
    const received=(credit.receipts||[]).reduce((sum,item)=>sum+Number(item.amount||0),0);
    records.push({type:'Vendor Defect Return',dateOrPeriod:excelSerial(credit.returnDate)||0,name:credit.vendor,source:'',amount:Number(credit.amount||0),received,outstanding:Math.max(0,Number(credit.amount||0)-received),notes:credit.notes||'',recordId:id});
    for(const receipt of credit.receipts||[]) records.push({type:'Vendor Refund Received',dateOrPeriod:excelSerial(receipt.date)||0,name:credit.vendor,source:'',amount:Number(receipt.amount||0),received:0,outstanding:0,notes:'',recordId:id});
  }
  const headers=['Record Type','Month / Date','Person / Vendor','Source','Amount','Repaid / Received','Remaining / Pending','Notes','Related Record ID','Payment Date','Paid Online','Paid Cash'];
  const tableHeader=`<row r="3">${headers.map((header,index)=>cellText(`${excelColumn(index)}3`,header,'5')).join('')}</row>`;
  const rows=records.map((record,index)=>{const row=index+4;const dateCell=typeof record.dateOrPeriod==='number'?cellNum(`B${row}`,record.dateOrPeriod,'17'):cellText(`B${row}`,record.dateOrPeriod,'12');return `<row r="${row}">${[cellText(`A${row}`,record.type,'12'),dateCell,cellText(`C${row}`,record.name,'12'),cellText(`D${row}`,record.source,'12'),cellNum(`E${row}`,record.amount,'18'),cellNum(`F${row}`,record.received,'18'),cellNum(`G${row}`,record.outstanding,'18'),cellText(`H${row}`,record.notes,'12'),cellText(`I${row}`,record.recordId,'12'),cellNum(`J${row}`,excelSerial(record.paymentDate),'17'),cellNum(`K${row}`,record.paidOnline??null,'18'),cellNum(`L${row}`,record.paidCash??null,'18')].join('')}</row>`;}).join('');
  const lastRow=Math.max(3,records.length+3);
  return {xml:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:L${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData><row r="1">${cellText('A1','Additional Finance & Liabilities','5')}</row><row r="2">${cellText('A2','Salary payments reduce the online and cash balances by their recorded split. Other finance costs and loan repayments reduce online balance. Borrowed loan amounts are liabilities, not available balance.','12')}</row>${tableHeader}${rows}</sheetData></worksheet>`,lastRow};
}

async function appendFinanceSheet(zip:JSZip,finance:AdditionalFinanceData){
  const workbookPath='xl/workbook.xml',relationshipsPath='xl/_rels/workbook.xml.rels',contentTypesPath='[Content_Types].xml';
  let workbook=await zip.file(workbookPath)!.async('string');
  let relationships=await zip.file(relationshipsPath)!.async('string');
  let contentTypes=await zip.file(contentTypesPath)!.async('string');
  const maxSheetId=Math.max(0,...[...workbook.matchAll(/<sheet\b[^>]*\bsheetId="(\d+)"/g)].map(match=>Number(match[1])));
  const maxRelationshipId=Math.max(0,...[...relationships.matchAll(/\bId="rId(\d+)"/g)].map(match=>Number(match[1])));
  const maxWorksheetNumber=Math.max(0,...Object.keys(zip.files).map(name=>/^xl\/worksheets\/sheet(\d+)\.xml$/.exec(name)).filter(Boolean).map(match=>Number(match![1])));
  const sheetId=maxSheetId+1,relationshipId=`rId${maxRelationshipId+1}`,sheetPath=`xl/worksheets/sheet${maxWorksheetNumber+1}.xml`;
  const sheetName='Additional Finance';
  workbook=workbook.replace('</sheets>',`<sheet name="${sheetName}" sheetId="${sheetId}" r:id="${relationshipId}"/></sheets>`);
  relationships=relationships.replace('</Relationships>',`<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${path.basename(sheetPath)}"/></Relationships>`);
  contentTypes=contentTypes.replace('</Types>',`<Override PartName="/${sheetPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  const sheet=buildFinanceSheet(finance);
  zip.file(workbookPath,workbook);zip.file(relationshipsPath,relationships);zip.file(contentTypesPath,contentTypes);zip.file(sheetPath,sheet.xml);
  return sheet.lastRow;
}

type AnalyticsSection = {
  title: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  startColumn?: number;
  startRow?: number;
};
type AnalyticsSheet = {
  xml: string;
  lastRow: number;
  sectionRows: Record<string, { start: number; end: number; startColumn: number }>;
  cellValues: Map<string, string | number>;
};
type AnalyticsChart = { templateNumber: number; formulas: string[]; title?: string };

function buildAnalyticsSheet(sections: AnalyticsSection[]) {
  const rows = new Map<number, Map<number, string>>();
  const sectionRows: AnalyticsSheet['sectionRows'] = {};
  const cellValues = new Map<string, string | number>();
  let lastRow = 2;
  const addCell=(row:number,column:number,markup:string)=>{
    const cells=rows.get(row)||new Map<number,string>();
    cells.set(column,markup);
    rows.set(row,cells);
  };
  addCell(1,0,cellText('A1','CONIC — ANALYTICS','5'));
  addCell(2,0,cellText('A2','Calculated from current MongoDB records at the time of export. Supporting charts are below the analytics tables.','12'));
  for (const section of sections) {
    const startColumn=section.startColumn||0;
    const titleRow=section.startRow||lastRow+2;
    for(let offset=0;offset<section.headers.length;offset++){
      const ref=`${excelColumn(startColumn+offset)}${titleRow}`;
      addCell(titleRow,startColumn+offset,offset===0?cellText(ref,section.title,'1'):`<c r="${ref}" s="1"/>`);
    }
    const headerRow=titleRow+1;
    section.headers.forEach((header,index)=>{
      const column=startColumn+index,ref=`${excelColumn(column)}${headerRow}`;
      addCell(headerRow,column,cellText(ref,header,'5'));
    });
    const dataStart=headerRow+1;
    for(const [rowIndex,values] of section.rows.entries()){
      const rowNumber=dataStart+rowIndex;
      values.forEach((value,index)=>{
        const column=startColumn+index,ref=`${excelColumn(column)}${rowNumber}`;
        cellValues.set(`Analytics!${ref}`,value);
        addCell(rowNumber,column,typeof value==='number'?cellNum(ref,value,'18'):cellText(ref,value,'12'));
      });
    }
    const dataEnd=dataStart+section.rows.length-1;
    sectionRows[section.title]={start:dataStart,end:dataEnd,startColumn};
    lastRow=Math.max(lastRow,dataEnd,titleRow+1);
  }
  const serializedRows=[...rows.entries()].sort(([a],[b])=>a-b).map(([rowNumber,cells])=>
    `<row r="${rowNumber}">${[...cells.entries()].sort(([a],[b])=>a-b).map(([,markup])=>markup).join('')}</row>`
  ).join('');
  const lastColumn=excelColumn(Math.max(5,...sections.map(section=>(section.startColumn||0)+section.headers.length-1)));
  return {
    xml:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols><col min="1" max="1" width="32" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/><col min="3" max="3" width="16" customWidth="1"/><col min="4" max="4" width="3" customWidth="1"/><col min="5" max="5" width="32" customWidth="1"/><col min="6" max="6" width="18" customWidth="1"/><col min="7" max="7" width="3" customWidth="1"/><col min="8" max="8" width="34" customWidth="1"/><col min="9" max="9" width="18" customWidth="1"/><col min="10" max="10" width="20" customWidth="1"/></cols><sheetData>${serializedRows}</sheetData></worksheet>`,
    lastRow,
    sectionRows,
    cellValues
  };
}

function replaceChartFormulas(xml:string,formulas:string[],title?:string){
  let index=0;
  const replaced=xml.replace(/<c:f>[\s\S]*?<\/c:f>/g,()=>{
    const formula=formulas[index++];
    if(!formula) throw new Error('Analytics chart source ranges do not match the template chart.');
    return `<c:f>${esc(formula)}</c:f>`;
  });
  if(index!==formulas.length) throw new Error('Analytics chart is missing a source range.');
  return title?replaced.replace(/(<c:title>[\s\S]*?<a:t>)[\s\S]*?(<\/a:t>[\s\S]*?<\/c:title>)/,`$1${esc(title)}$2`):replaced;
}

function setAnchorCoordinate(anchor:string,point:'from'|'to',coordinate:'col'|'row',value:number){
  const pattern=new RegExp(`(<xdr:${point}>[\\\\s\\\\S]*?<xdr:${coordinate}>)(\\\\d+)(<\\\\/xdr:${coordinate}>)`);
  return anchor.replace(pattern,`$1${value}$3`);
}

async function appendAnalyticsSheet(zip:JSZip,sheet:AnalyticsSheet,charts:AnalyticsChart[]){
  const workbookPath='xl/workbook.xml',relationshipsPath='xl/_rels/workbook.xml.rels',contentTypesPath='[Content_Types].xml';
  let workbook=await zip.file(workbookPath)!.async('string');
  let relationships=await zip.file(relationshipsPath)!.async('string');
  let contentTypes=await zip.file(contentTypesPath)!.async('string');
  const maxSheetId=Math.max(0,...[...workbook.matchAll(/<sheet\b[^>]*\bsheetId="(\d+)"/g)].map(match=>Number(match[1])));
  const maxRelationshipId=Math.max(0,...[...relationships.matchAll(/\bId="rId(\d+)"/g)].map(match=>Number(match[1])));
  const maxWorksheetNumber=Math.max(0,...Object.keys(zip.files).map(name=>/^xl\/worksheets\/sheet(\d+)\.xml$/.exec(name)).filter(Boolean).map(match=>Number(match![1])));
  const relationshipId=`rId${maxRelationshipId+1}`,sheetPath=`xl/worksheets/sheet${maxWorksheetNumber+1}.xml`;
  workbook=workbook.replace('</sheets>',`<sheet name="Analytics" sheetId="${maxSheetId+1}" r:id="${relationshipId}"/></sheets>`);
  relationships=relationships.replace('</Relationships>',`<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${path.basename(sheetPath)}"/></Relationships>`);
  const maxDrawingNumber=Math.max(0,...Object.keys(zip.files).map(name=>/^xl\/drawings\/drawing(\d+)\.xml$/.exec(name)).filter(Boolean).map(match=>Number(match![1])));
  const drawingPath=`xl/drawings/drawing${maxDrawingNumber+1}.xml`;
  const drawingRelationshipId='rId1';
  let worksheetXml=sheet.xml.replace('</worksheet>',`<drawing r:id="${drawingRelationshipId}"/></worksheet>`);
  const worksheetRelationships=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${drawingRelationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/${path.basename(drawingPath)}"/></Relationships>`;
  const templateDrawing=await zip.file('xl/drawings/drawing2.xml')!.async('string');
  const templateAnchors=[...templateDrawing.matchAll(/<xdr:twoCellAnchor[\s\S]*?<\/xdr:twoCellAnchor>/g)].map(match=>match[0]);
  if(templateAnchors.length<2) throw new Error('Template dashboard chart anchors are missing.');
  const drawingAnchors:string[]=[];
  const drawingRelationships:string[]=[];
  const maxChartNumber=Math.max(0,...Object.keys(zip.files).map(name=>/^xl\/charts\/chart(\d+)\.xml$/.exec(name)).filter(Boolean).map(match=>Number(match![1])));
  for(const [index,chart] of charts.entries()){
    const chartNumber=maxChartNumber+index+1;
    const chartPath=`xl/charts/chart${chartNumber}.xml`;
    const original=await zip.file(`xl/charts/chart${chart.templateNumber}.xml`)!.async('string');
    const chartXml=replaceChartFormulas(original,chart.formulas,chart.title);
    zip.file(chartPath,chartXml);
    const columns=index%2===0?{from:0,to:7}:{from:7,to:14};
    const firstRow=sheet.lastRow+2+Math.floor(index/2)*17;
    const lastRow=firstRow+15;
    let anchor=setAnchorCoordinate(templateAnchors[index%2],'from','col',columns.from);
    anchor=setAnchorCoordinate(anchor,'to','col',columns.to);
    anchor=setAnchorCoordinate(anchor,'from','row',firstRow);
    anchor=setAnchorCoordinate(anchor,'to','row',lastRow);
    anchor=anchor.replace(/<xdr:cNvPr id="\d+"/,`<xdr:cNvPr id="${index+1}"`);
    anchor=anchor.replace(/r:id="rId\d+"/,`r:id="rId${index+1}"`);
    drawingAnchors.push(anchor);
    drawingRelationships.push(`<Relationship Id="rId${index+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartNumber}.xml"/>`);
    contentTypes=contentTypes.replace('</Types>',`<Override PartName="/${chartPath}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`);
  }
  const drawingXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${drawingAnchors.join('')}</xdr:wsDr>`;
  const drawingRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRelationships.join('')}</Relationships>`;
  contentTypes=contentTypes.replace('</Types>',`<Override PartName="/${sheetPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  contentTypes=contentTypes.replace('</Types>',`<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
  zip.file(workbookPath,workbook);
  zip.file(relationshipsPath,relationships);
  zip.file(contentTypesPath,contentTypes);
  zip.file(sheetPath,worksheetXml);
  zip.file(`xl/worksheets/_rels/${path.basename(sheetPath)}.rels`,worksheetRelationships);
  zip.file(drawingPath,drawingXml);
  zip.file(`xl/drawings/_rels/${path.basename(drawingPath)}.rels`,drawingRels);
}

function buildDailyXml(entries: DailyEntry[], expenseCategories: string[], purchases: PurchaseEntry[], opening: { online: number; cash: number }, finance:AdditionalFinanceData, dailyLimit:number, purchaseLimit:number, financeSheetLastRow:number) {
  const categories = [...new Set([...expenseCategories, ...entries.flatMap(entry => Object.keys(entry.expenses || {}))])];
  const fixedCategories = categories.slice(0, 4);
  const overflowCategories = categories.slice(4);
  const financeEnd=financeSheetLastRow;
  const financeSum=(type:string,dateColumn:'B'|'J',dateCriteria:string)=>`SUMIFS('Additional Finance'!$E$4:$E$${financeEnd},'Additional Finance'!$A$4:$A$${financeEnd},"${type}",'Additional Finance'!$${dateColumn}$4:$${dateColumn}$${financeEnd},${dateCriteria})`;
  const onlinePurchaseOutflow=(row:number)=>`SUMIFS('Weekly Purchases'!$N$2:$N$${purchaseLimit},'Weekly Purchases'!$B$2:$B$${purchaseLimit},"<>",'Weekly Purchases'!$B$2:$B$${purchaseLimit},"<="&$A${row})+SUMIFS('Weekly Purchases'!$N$2:$N$${purchaseLimit},'Weekly Purchases'!$B$2:$B$${purchaseLimit},"",'Weekly Purchases'!$A$2:$A$${purchaseLimit},"<="&$A${row})`;
  const cashPurchaseOutflow=(row:number)=>`SUMIFS('Weekly Purchases'!$O$2:$O$${purchaseLimit},'Weekly Purchases'!$B$2:$B$${purchaseLimit},"<>",'Weekly Purchases'!$B$2:$B$${purchaseLimit},"<="&$A${row})+SUMIFS('Weekly Purchases'!$O$2:$O$${purchaseLimit},'Weekly Purchases'!$B$2:$B$${purchaseLimit},"",'Weekly Purchases'!$A$2:$A$${purchaseLimit},"<="&$A${row})`;
  const rows = Array.from({length:dailyLimit-1},(_,index)=>{
    const r=index+2,e=entries[index];
    const totalSales=Number(e?.onlineSales||0)+Number(e?.cashSales||0);
    const totalExpenses=Object.values(e?.expenses||{}).reduce((sum,value)=>sum+Number(value||0),0);
    const balances=e?balanceThrough(e.date,entries,purchases,opening,finance.months,finance.vendorReturns,finance.loans):undefined;
    const expenseFormulaRanges=[`E${r}:H${r}`,...overflowCategories.map((_,i)=>`${excelColumn(16+i)}${r}`)];
    const expenseFormula=`IF($A${r}="","",SUM(${expenseFormulaRanges.join(',')}))`;
    const totalSalesFormula=`IF($A${r}="","",SUM(B${r}:C${r}))`;
    const financeCriteria=`"<="&$A${r}`;
    const financeOutflowFormula=`(${['Salary','Truck EMI','Auto EMI','Room Rent','Savings Deposit','Dated Savings Deposit'].map(type=>financeSum(type,'J',financeCriteria)).join('+')||'0'}-${financeSum('Auto EMI Friend Share','J',financeCriteria)})`;
    const loanRepaymentsFormula=financeSum('Loan Repayment','B',financeCriteria);
    const refundReceiptsFormula=financeSum('Vendor Refund Received','B',financeCriteria);
    const onlineBalanceFormula=`IF($A${r}="","",Settings!$B$3+SUMIFS($B$2:$B$${dailyLimit},$A$2:$A$${dailyLimit},"<="&$A${r})-SUMIFS($J$2:$J$${dailyLimit},$A$2:$A$${dailyLimit},"<="&$A${r})-(${onlinePurchaseOutflow(r)})-(${financeOutflowFormula})-(${loanRepaymentsFormula}))`;
    const cashBalanceFormula=`IF($A${r}="","",Settings!$B$4+SUMIFS($C$2:$C$${dailyLimit},$A$2:$A$${dailyLimit},"<="&$A${r})-SUMIFS($K$2:$K$${dailyLimit},$A$2:$A$${dailyLimit},"<="&$A${r})-(${cashPurchaseOutflow(r)}))`;
    const cells=[
      ...(e?[cellNum(`A${r}`,excelSerial(e.date),'17'),cellNum(`B${r}`,e.onlineSales,'18'),cellNum(`C${r}`,e.cashSales,'18')]:[]),
      cellFormula(`D${r}`,totalSalesFormula,e?totalSales:undefined,'15'),
      ...fixedCategories.map((name,i)=>e?cellNum(`${excelColumn(4+i)}${r}`,Number(e.expenses?.[name]||0),'18'): ''),
      ...Array.from({length:Math.max(0,4-fixedCategories.length)},(_,i)=>e?cellNum(`${excelColumn(4+fixedCategories.length+i)}${r}`,0,'18'):''),
      cellFormula(`I${r}`,expenseFormula,e?totalExpenses:undefined,'15'),
      ...(e?[cellNum(`J${r}`,e.expensePaidOnline,'15'),cellNum(`K${r}`,e.expensePaidCash,'15')]:[]),
      cellFormula(`L${r}`,onlineBalanceFormula,balances?.online,'15'),
      cellFormula(`M${r}`,cashBalanceFormula,balances?.cash,'15'),
      cellFormula(`N${r}`,`IF($A${r}="","",L${r}+M${r}+(${refundReceiptsFormula}))`,balances?.total,'15'),
      cellFormula(`O${r}`,`IF($A${r}="","",D${r}-I${r})`,e?totalSales-totalExpenses:undefined,'15'),
      ...(e?[cellText(`P${r}`,e.notes||'')]:[]),
      ...overflowCategories.map((name,i)=>e?cellNum(`${excelColumn(16+i)}${r}`,Number(e.expenses?.[name]||0),'18'):'')
    ];
    return `<row r="${r}">${cells.join('')}</row>`;
  }).join('');
  const headers=['Date','Online Sales','Cash Sales','Total Sales',...fixedCategories,...Array.from({length:Math.max(0,4-fixedCategories.length)},()=>''),'Total Expenses','Expense Paid Online','Expense Paid Cash','Online Balance','Cash Balance','Total Balance','Daily Net Amount','Notes',...overflowCategories];
  const header=`<row r="1">${headers.map((x,i)=>cellText(`${excelColumn(i)}1`,x,'5')).join('')}</row>`;
  const lastRow=dailyLimit,lastColumn=excelColumn(Math.max(15,15+overflowCategories.length));
  const xml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>${header}${rows}</sheetData><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>`;
  return {xml,headers,lastRow,lastColumn};
}
function buildPurchaseXml(entries: PurchaseEntry[], vendors: string[], purchaseLimit:number) {
  const allCategories = [...new Set([...vendors, ...entries.flatMap(entry=>Object.keys(entry.vendorAmounts||{}))])].filter(name=>name!=='Other'&&name!=='Transport');
  const fixedVendors=allCategories.slice(0,10);
  const overflowCategories=[...allCategories.slice(10),'Other','Transport'];
  const rows = Array.from({length:purchaseLimit-1},(_,index)=>{
    const r=index+2,e=entries[index];
    const total=Object.values(e?.vendorAmounts||{}).reduce((sum,value)=>sum+Number(value||0),0);
    const pending=Math.max(0,total-Number(e?.onlinePurchasePaid||0)-Number(e?.cashPurchasePaid||0));
    const totalRanges=[`C${r}:L${r}`,...overflowCategories.map((_,i)=>`${excelColumn(16+i)}${r}`)];
    const cells=[
      ...(e?[cellNum(`A${r}`,excelSerial(e.purchaseDate),'17'),cellNum(`B${r}`,excelSerial(e.paymentDate),'17')]:[]),
      ...fixedVendors.map((name,i)=>e?cellNum(`${excelColumn(2+i)}${r}`,Number(e.vendorAmounts?.[name]||0),'18'):''),
      ...Array.from({length:Math.max(0,10-fixedVendors.length)},(_,i)=>e?cellNum(`${excelColumn(2+fixedVendors.length+i)}${r}`,0,'18'):''),
      cellFormula(`M${r}`,`IF($A${r}="","",SUM(${totalRanges.join(',')}))`,e?total:undefined,'15'),
      ...(e?[cellNum(`N${r}`,Number(e.onlinePurchasePaid||0),'15'),cellNum(`O${r}`,Number(e.cashPurchasePaid||0),'18')]:[]),
      cellFormula(`P${r}`,`IF($A${r}="","",MAX(0,M${r}-N${r}-O${r}))`,e?pending:undefined,'15'),
      ...overflowCategories.map((name,i)=>e?cellNum(`${excelColumn(16+i)}${r}`,Number(e.vendorAmounts?.[name]||0),'18'):'')
    ];
    return `<row r="${r}">${cells.join('')}</row>`;
  }).join('');
  const headers=['Purchase Date','Payment Date',...fixedVendors,...Array.from({length:Math.max(0,10-fixedVendors.length)},()=>''),'Total Weekly Purchase','Online Purchase Paid','Cash Purchase Paid','Pending Purchase',...overflowCategories];
  const header=`<row r="1">${headers.map((x,i)=>cellText(`${excelColumn(i)}1`,x,'5')).join('')}</row>`;
  const lastRow=purchaseLimit,lastColumn=excelColumn(Math.max(15,15+overflowCategories.length));
  const xml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>${header}${rows}</sheetData><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>`;
  return {xml,headers,lastRow,lastColumn};
}

export async function buildWorkbookFromData(template:Buffer,daily:DailyEntry[],purchases:PurchaseEntry[],settings:BusinessSettings,finance:AdditionalFinanceData={}):Promise<Buffer>{
  const templateWorkbook=XLSX.read(template,{cellDates:true});
  const dashboard=templateWorkbook.Sheets['Monthly Dashboard'];
  const yearlyDashboard=templateWorkbook.Sheets['Yearly Dashboard'];
  const activityDates=[
    ...daily.map(entry=>entry.date),
    ...purchases.flatMap(entry=>[entry.purchaseDate,entry.paymentDate].filter((date):date is string=>Boolean(date))),
    ...(finance.months||[]).map(month=>/^\d{4}-\d{2}$/.test(month.period)?`${month.period}-01`: ''),
    ...(finance.loans||[]).flatMap(loan=>[loan.takenDate,...(loan.repayments||[]).map(item=>item.date)]),
    ...(finance.vendorReturns||[]).flatMap(item=>[item.returnDate,...(item.receipts||[]).map(receipt=>receipt.date)])
  ].filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  const latestActivityDate=activityDates.at(-1);
  const monthlySelectedYear=latestActivityDate?Number(latestActivityDate.slice(0,4)):Number(dashboard?.D3?.v)||new Date().getFullYear();
  const selectedMonth=latestActivityDate?Number(latestActivityDate.slice(5,7)):Math.max(1,MONTHS.indexOf(String(dashboard?.B3?.v))+1);
  const selectedYearlyYear=latestActivityDate?monthlySelectedYear:Number(yearlyDashboard?.B3?.v)||new Date().getFullYear();
  const periodStart=`${monthlySelectedYear}-${String(selectedMonth).padStart(2,'0')}-01`;
  const nextMonthDate=new Date(Date.UTC(monthlySelectedYear,selectedMonth,1));
  const periodEnd=nextMonthDate.toISOString().slice(0,10);
  const monthDaily=daily.filter(entry=>entry.date>=periodStart&&entry.date<periodEnd);
  const monthPurchases=purchases.filter(entry=>entry.purchaseDate>=periodStart&&entry.purchaseDate<periodEnd);
  const monthFinance=(finance.months||[]).find(entry=>entry.period===`${monthlySelectedYear}-${String(selectedMonth).padStart(2,'0')}`);
  const monthlySalary=(monthFinance?.salaries||[]).reduce((sum,salary)=>sum+Number(salary.amount||0),0);
  const autoEmiBusinessShare=Math.max(0,Number(monthFinance?.autoEmi||0)-Number(monthFinance?.autoEmiFriendShare||0));
  const monthlyOperationsExpenses=monthlySalary+Number(monthFinance?.truckEmi||0)+autoEmiBusinessShare+Number(monthFinance?.roomRent||0);
  const monthlyLoanRepayments=(finance.loans||[]).flatMap(loan=>loan.repayments||[]).filter(repayment=>repayment.date>=periodStart&&repayment.date<periodEnd).reduce((sum,repayment)=>sum+Number(repayment.amount||0),0);
  const totalSales=monthDaily.reduce((total,entry)=>total+Number(entry.onlineSales||0)+Number(entry.cashSales||0),0);
  const dailyExpenses=monthDaily.reduce((total,entry)=>total+Object.values(entry.expenses||{}).reduce((amount,value)=>amount+Number(value||0),0),0);
  const totalExpenses=dailyExpenses+monthlyOperationsExpenses+monthlyLoanRepayments;
  const totalPurchases=monthPurchases.reduce((total,entry)=>total+Object.values(entry.vendorAmounts||{}).reduce((amount,value)=>amount+Number(value||0),0),0);
  const dayBeforeStart=new Date(`${periodStart}T00:00:00Z`);dayBeforeStart.setUTCDate(dayBeforeStart.getUTCDate()-1);
  const openingBalances=balanceThrough(dayBeforeStart.toISOString().slice(0,10),daily,purchases,{online:settings.openingOnlineBalance,cash:settings.openingCashBalance},finance.months,finance.vendorReturns,finance.loans);
  const closingBalances=balanceThrough(new Date(Date.UTC(monthlySelectedYear,selectedMonth,0)).toISOString().slice(0,10),daily,purchases,{online:settings.openingOnlineBalance,cash:settings.openingCashBalance},finance.months,finance.vendorReturns,finance.loans);
  const expenseCategories=[...new Set([...settings.expenseCategories,...monthDaily.flatMap(entry=>Object.keys(entry.expenses||{}))])];
  const purchaseVendors=[...new Set([...settings.vendors,...monthPurchases.flatMap(entry=>Object.keys(entry.vendorAmounts||{}))])].filter(name=>name!=='Other'&&name!=='Transport').slice(0,10);
  const extraExpenseCategories=expenseCategories.slice(4);
  const allPurchaseCategories=[...new Set([...settings.vendors,...monthPurchases.flatMap(entry=>Object.keys(entry.vendorAmounts||{}))])].filter(name=>name!=='Other'&&name!=='Transport');
  const extraPurchaseCategories=[...allPurchaseCategories.slice(10),'Other','Transport'];
  const monthlySummaryValues:Record<string,number>={
    B5:monthDaily.reduce((total,entry)=>total+Number(entry.onlineSales||0),0),
    B6:monthDaily.reduce((total,entry)=>total+Number(entry.cashSales||0),0),
    B7:totalSales,
    B19:totalPurchases,
    B25:totalExpenses,
    B27:openingBalances.online,
    B28:closingBalances.online,
    B29:openingBalances.cash,
    B30:closingBalances.cash,
    B31:closingBalances.total,
    B33:totalSales-totalPurchases-totalExpenses
  };
  purchaseVendors.forEach((vendor,index)=>monthlySummaryValues[`B${9+index}`]=monthPurchases.reduce((total,entry)=>total+Number(entry.vendorAmounts?.[vendor]||0),0));
  expenseCategories.slice(0,4).forEach((category,index)=>monthlySummaryValues[`B${21+index}`]=monthDaily.reduce((total,entry)=>total+Number(entry.expenses?.[category]||0),0));
  const dailyLimit=Math.max(495,daily.length+1),purchaseLimit=Math.max(503,purchases.length+1);
  const zip=await JSZip.loadAsync(template);
  const financeSheetLastRow=Math.max(4,await appendFinanceSheet(zip,finance));
  const dailySheet=buildDailyXml(daily,settings.expenseCategories,purchases,{online:settings.openingOnlineBalance,cash:settings.openingCashBalance},finance,dailyLimit,purchaseLimit,financeSheetLastRow);
  const purchaseSheet=buildPurchaseXml(purchases,settings.vendors,purchaseLimit);
  const dailySheetPath='xl/worksheets/sheet3.xml',purchaseSheetPath='xl/worksheets/sheet4.xml';
  const dailyTemplate=await zip.file(dailySheetPath)!.async('string'),purchaseTemplate=await zip.file(purchaseSheetPath)!.async('string');
  zip.file(dailySheetPath,replaceWorksheetData(dailyTemplate,dailySheet.xml,495));
  zip.file(purchaseSheetPath,replaceWorksheetData(purchaseTemplate,purchaseSheet.xml,503));
  const dailyTablePath='xl/tables/table1.xml',purchaseTablePath='xl/tables/table2.xml';
  zip.file(dailyTablePath,updateTableXml(await zip.file(dailyTablePath)!.async('string'),dailySheet.headers,dailySheet.lastColumn,Math.max(495,dailySheet.lastRow)));
  zip.file(purchaseTablePath,updateTableXml(await zip.file(purchaseTablePath)!.async('string'),purchaseSheet.headers,purchaseSheet.lastColumn,Math.max(503,purchaseSheet.lastRow)));
  const financeRange=`'Additional Finance'!$E$4:$E$${financeSheetLastRow}`;
  const financeTypeRange=`'Additional Finance'!$A$4:$A$${financeSheetLastRow}`;
  const financePeriodRange=`'Additional Finance'!$B$4:$B$${financeSheetLastRow}`;
  const financePaymentDateRange=`'Additional Finance'!$J$4:$J$${financeSheetLastRow}`;
  const financeSum=(type:string,periodCriteria:string)=>`SUMIFS(${financeRange},${financeTypeRange},"${type}",${financePeriodRange},${periodCriteria})`;
  const financeDatedSum=(type:string,dateCriteria:string)=>`SUMIFS(${financeRange},${financeTypeRange},"${type}",${financePaymentDateRange},${dateCriteria})`;
  const financeOutflowThrough=(dateCriteria:string)=>`(${['Salary','Truck EMI','Auto EMI','Room Rent','Savings Deposit','Dated Savings Deposit'].map(type=>financeDatedSum(type,dateCriteria)).join('+')||'0'}-${financeDatedSum('Auto EMI Friend Share',dateCriteria)})`;
  const loanRepaymentsThrough=(dateCriteria:string)=>`SUMIFS(${financeRange},${financeTypeRange},"Loan Repayment",${financePeriodRange},${dateCriteria})`;
  const vendorRefundsThrough=(dateCriteria:string)=>`SUMIFS(${financeRange},${financeTypeRange},"Vendor Refund Received",${financePeriodRange},${dateCriteria})`;
  const onlinePurchasePaymentsThrough=(dateCriteria:string)=>`SUMIFS('Weekly Purchases'!$N$2:$N$${purchaseLimit},'Weekly Purchases'!$B$2:$B$${purchaseLimit},"<>",'Weekly Purchases'!$B$2:$B$${purchaseLimit},${dateCriteria})+SUMIFS('Weekly Purchases'!$N$2:$N$${purchaseLimit},'Weekly Purchases'!$B$2:$B$${purchaseLimit},"",'Weekly Purchases'!$A$2:$A$${purchaseLimit},${dateCriteria})`;
  const cashPurchasePaymentsThrough=(dateCriteria:string)=>`SUMIFS('Weekly Purchases'!$O$2:$O$${purchaseLimit},'Weekly Purchases'!$B$2:$B$${purchaseLimit},"<>",'Weekly Purchases'!$B$2:$B$${purchaseLimit},${dateCriteria})+SUMIFS('Weekly Purchases'!$O$2:$O$${purchaseLimit},'Weekly Purchases'!$B$2:$B$${purchaseLimit},"",'Weekly Purchases'!$A$2:$A$${purchaseLimit},${dateCriteria})`;
  const onlineBalanceThrough=(dateCriteria:string)=>`Settings!$B$3+SUMIFS('Daily Sales & Expenses'!$B$2:$B$${dailyLimit},'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},${dateCriteria})-SUMIFS('Daily Sales & Expenses'!$J$2:$J$${dailyLimit},'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},${dateCriteria})-(${onlinePurchasePaymentsThrough(dateCriteria)})-(${financeOutflowThrough(dateCriteria)})-(${loanRepaymentsThrough(dateCriteria)})`;
  const cashBalanceThrough=(dateCriteria:string)=>`Settings!$B$4+SUMIFS('Daily Sales & Expenses'!$C$2:$C$${dailyLimit},'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},${dateCriteria})-SUMIFS('Daily Sales & Expenses'!$K$2:$K$${dailyLimit},'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},${dateCriteria})-(${cashPurchasePaymentsThrough(dateCriteria)})`;
  const monthlyFinanceExpensesFormula=`(${['Salary','Truck EMI','Auto EMI','Room Rent'].map(type=>financeSum(type,'TEXT($B$3,"yyyy-mm")')).join('+')||'0'}-${financeSum('Auto EMI Friend Share','TEXT($B$3,"yyyy-mm")')})`;
  const monthlyLoanRepaymentsFormula=`SUMIFS(${financeRange},${financeTypeRange},"Loan Repayment",${financePeriodRange},">="&$B$3,${financePeriodRange},"<"&EDATE($B$3,1))`;
  const settingsPath='xl/worksheets/sheet6.xml';
  let sxml=await zip.file(settingsPath)!.async('string');
  const put = (ref:string,val:string) => { sxml=setWorksheetCell(sxml,ref,cellText(ref,val,'12')); };
  const putNum=(ref:string,val:number)=>{ sxml=setWorksheetCell(sxml,ref,cellNum(ref,val,'12')); };
  putNum('B3',settings.openingOnlineBalance); putNum('B4',settings.openingCashBalance);
  const existingSettings=settingsSlots(sxml);
  const vendorSlots=Math.max(settings.vendors.length,existingSettings.vendors);
  const expenseSlots=Math.max(settings.expenseCategories.length,existingSettings.expenses);
  for(let index=0;index<vendorSlots;index++) put(`A${7+index}`,settings.vendors[index]||'');
  for(let index=0;index<expenseSlots;index++) put(`C${7+index}`,settings.expenseCategories[index]||'');
  zip.file(settingsPath,sxml);
  const monthlySummaryPath='xl/worksheets/sheet5.xml';
  let summaryXml=await zip.file(monthlySummaryPath)!.async('string');
  summaryXml=setFormulaCell(summaryXml,'B19',`SUMIFS('Weekly Purchases'!$M$2:$M$${purchaseLimit},'Weekly Purchases'!$A$2:$A$${purchaseLimit},">="&$B$3,'Weekly Purchases'!$A$2:$A$${purchaseLimit},"<"&EDATE($B$3,1))`);
  summaryXml=setFormulaCell(summaryXml,'B25',`SUMIFS('Daily Sales & Expenses'!$I$2:$I$${dailyLimit},'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},">="&$B$3,'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},"<"&EDATE($B$3,1))+(${monthlyFinanceExpensesFormula})+(${monthlyLoanRepaymentsFormula})`);
  summaryXml=setFormulaCell(summaryXml,'B27',onlineBalanceThrough('"<"&$B$3'));
  summaryXml=setFormulaCell(summaryXml,'B28',onlineBalanceThrough('"<"&EDATE($B$3,1)'));
  summaryXml=setFormulaCell(summaryXml,'B29',cashBalanceThrough('"<"&$B$3'));
  summaryXml=setFormulaCell(summaryXml,'B30',cashBalanceThrough('"<"&EDATE($B$3,1)'));
  summaryXml=setFormulaCell(summaryXml,'B31',`B28+B30+(${vendorRefundsThrough('"<"&EDATE($B$3,1)')})`);
  for(let index=0;index<4;index++){
    const row=21+index,category=settings.expenseCategories[index]||'',column=excelColumn(4+index);
    summaryXml=setWorksheetCell(summaryXml,`A${row}`,cellText(`A${row}`,category,'12'));
    summaryXml=setFormulaCell(summaryXml,`B${row}`,`SUMIFS('Daily Sales & Expenses'!$${column}$2:$${column}$${dailyLimit},'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},">="&$B$3,'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},"<"&EDATE($B$3,1))`);
  }
  for(const [ref,value] of Object.entries(monthlySummaryValues)) summaryXml=setFormulaCache(summaryXml,ref,value);
  let additionalRow=35;
  if(extraExpenseCategories.length){
    summaryXml=setWorksheetCell(summaryXml,`A${additionalRow}`,cellText(`A${additionalRow}`,'Additional Expense Categories','5'));
    additionalRow++;
    for(const [index,category] of extraExpenseCategories.entries()){
      const row=additionalRow++,column=excelColumn(16+index),value=monthDaily.reduce((total,entry)=>total+Number(entry.expenses?.[category]||0),0);
      summaryXml=setWorksheetCell(summaryXml,`A${row}`,cellText(`A${row}`,category,'12'));
      summaryXml=setFormulaCell(summaryXml,`B${row}`,`SUMIFS('Daily Sales & Expenses'!$${column}$2:$${column}$${dailyLimit},'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},">="&$B$3,'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},"<"&EDATE($B$3,1))`,value);
    }
  }
  if(monthFinance){
    const financeRows=[['Monthly salary',monthlySalary],['Truck EMI',Number(monthFinance.truckEmi||0)],['Auto EMI (business share)',Math.max(0,Number(monthFinance.autoEmi||0)-Number(monthFinance.autoEmiFriendShare||0))],['Room rent',Number(monthFinance.roomRent||0)],['Loan repayments',monthlyLoanRepayments]] as const;
    summaryXml=setWorksheetCell(summaryXml,`A${additionalRow}`,cellText(`A${additionalRow}`,'Monthly Finance','5'));
    additionalRow++;
    for(const [label,value] of financeRows){summaryXml=setWorksheetCell(summaryXml,`A${additionalRow}`,cellText(`A${additionalRow}`,label,'12'));summaryXml=setWorksheetCell(summaryXml,`B${additionalRow}`,cellNum(`B${additionalRow}`,value,'12'));additionalRow++;}
  }
  if(extraPurchaseCategories.length){
    summaryXml=setWorksheetCell(summaryXml,`A${additionalRow}`,cellText(`A${additionalRow}`,'Additional Purchase Categories','5'));
    additionalRow++;
    for(const [index,category] of extraPurchaseCategories.entries()){
      const row=additionalRow++,column=excelColumn(16+index),value=monthPurchases.reduce((total,entry)=>total+Number(entry.vendorAmounts?.[category]||0),0);
      summaryXml=setWorksheetCell(summaryXml,`A${row}`,cellText(`A${row}`,category,'12'));
      summaryXml=setFormulaCell(summaryXml,`B${row}`,`SUMIFS('Weekly Purchases'!$${column}$2:$${column}$503,'Weekly Purchases'!$A$2:$A$503,">="&$B$3,'Weekly Purchases'!$A$2:$A$503,"<"&EDATE($B$3,1))`,value);
    }
  }
  zip.file(monthlySummaryPath,summaryXml);
  for(const name of Object.keys(zip.files).filter(file=>/^xl\/(worksheets|charts)\/.*\.xml$/.test(file))){
    const file=zip.file(name);if(!file)continue;
    const xml=await file.async('string');
    zip.file(name,xml.replace(/\$495\b/g,`$${dailyLimit}`).replace(/\$503\b/g,`$${purchaseLimit}`));
  }
  const dashboardPath='xl/worksheets/sheet1.xml';
  let dashboardXml=await zip.file(dashboardPath)!.async('string');
  const latestDaily=daily.at(-1);
  const latestExpenses=Object.values(latestDaily?.expenses||{}).reduce((total,value)=>total+Number(value||0),0);
  const latestBalances=latestDaily?balanceThrough(latestDaily.date,daily,purchases,{online:settings.openingOnlineBalance,cash:settings.openingCashBalance},finance.months,finance.vendorReturns,finance.loans):closingBalances;
  const latestSales=Number(latestDaily?.onlineSales||0)+Number(latestDaily?.cashSales||0);
  const monthlyDashboardCaches:Record<string,number>={A6:monthlySummaryValues.B5,D6:monthlySummaryValues.B6,G6:monthlySummaryValues.B7,A9:totalPurchases,D9:totalExpenses,G9:closingBalances.online,A12:closingBalances.cash,D12:closingBalances.total,G12:totalSales-totalPurchases-totalExpenses,B16:latestSales,C16:latestExpenses,D16:latestSales-latestExpenses,E16:latestBalances.total,H16:latestDaily?excelSerial(latestDaily.date)||0:0};
  for(const [ref,value] of Object.entries(monthlyDashboardCaches)) dashboardXml=setFormulaCache(dashboardXml,ref,value);
  zip.file(dashboardPath,dashboardXml);
  let yearlyXml=await zip.file('xl/worksheets/sheet2.xml')!.async('string');
  yearlyXml=setCellValue(yearlyXml,'B3',selectedYearlyYear);
  const calcValues=new Map<string,string|number>();
  const setCalcValue=(ref:string,value:string|number)=>{calcValues.set(ref,value);};
  let calcXml=await zip.file('xl/worksheets/sheet7.xml')!.async('string');
  const onlineSales=Number(monthlySummaryValues.B5||0),cashSales=Number(monthlySummaryValues.B6||0);
  for(const [ref,value] of Object.entries({D2:'Online Sales',D3:'Cash Sales',G2:'Sales',G3:'Purchases',G4:'Expenses'})) setCalcValue(ref,value);
  const chartSummaryValues:Record<string,number>={E2:onlineSales,E3:cashSales,H2:totalSales,H3:totalPurchases,H4:totalExpenses};
  for(const [ref,value] of Object.entries(chartSummaryValues)){calcXml=setFormulaCache(calcXml,ref,value);setCalcValue(ref,value);}
  for(let index=0;index<10;index++){
    const ref=`J${index+2}`,vendor=purchaseVendors[index]||'';
    calcXml=setCalcCachedText(calcXml,ref,vendor);
    setCalcValue(ref,vendor);
    const amount=vendor?monthPurchases.reduce((total,entry)=>total+Number(entry.vendorAmounts?.[vendor]||0),0):0;
    const amountRef=`K${index+2}`;
    calcXml=setFormulaCache(calcXml,amountRef,amount);
    setCalcValue(amountRef,amount);
  }
  let annualSales=0,annualPurchases=0,annualExpenses=0,annualNet=0;
  const yearlyAnalyticsRows:Array<Array<string|number>>=[];
  for(let month=1;month<=12;month++){
    const start=`${selectedYearlyYear}-${String(month).padStart(2,'0')}-01`;
    const end=new Date(Date.UTC(selectedYearlyYear,month,1)).toISOString().slice(0,10);
    const monthDaily=daily.filter(entry=>entry.date>=start&&entry.date<end);
    const monthPurchases=purchases.filter(entry=>entry.purchaseDate>=start&&entry.purchaseDate<end);
    const sales=monthDaily.reduce((total,entry)=>total+Number(entry.onlineSales||0)+Number(entry.cashSales||0),0);
    const monthlyRecord=(finance.months||[]).find(entry=>entry.period===`${selectedYearlyYear}-${String(month).padStart(2,'0')}`);
    const loanRepayments=(finance.loans||[]).flatMap(loan=>loan.repayments||[]).filter(repayment=>repayment.date>=start&&repayment.date<end).reduce((total,repayment)=>total+Number(repayment.amount||0),0);
    const expenses=monthDaily.reduce((total,entry)=>total+Object.values(entry.expenses||{}).reduce((amount,value)=>amount+Number(value||0),0),0)+(monthlyRecord?.salaries||[]).reduce((total,salary)=>total+Number(salary.amount||0),0)+Number(monthlyRecord?.truckEmi||0)+Math.max(0,Number(monthlyRecord?.autoEmi||0)-Number(monthlyRecord?.autoEmiFriendShare||0))+Number(monthlyRecord?.roomRent||0)+loanRepayments;
    const purchasesTotal=monthPurchases.reduce((total,entry)=>total+Object.values(entry.vendorAmounts||{}).reduce((amount,value)=>amount+Number(value||0),0),0);
    annualSales+=sales;annualPurchases+=purchasesTotal;annualExpenses+=expenses;annualNet+=sales-purchasesTotal-expenses;
    const balances=balanceThrough(new Date(Date.UTC(selectedYearlyYear,month,0)).toISOString().slice(0,10),daily,purchases,{online:settings.openingOnlineBalance,cash:settings.openingCashBalance},finance.months,finance.vendorReturns,finance.loans);
    yearlyAnalyticsRows.push([MONTHS[month-1],sales,purchasesTotal,expenses,sales-purchasesTotal-expenses,balances.total]);
    const row=5+month;
    for(const [column,value] of [['B',sales],['C',purchasesTotal],['D',expenses],['E',sales-purchasesTotal-expenses],['F',balances.total]] as const) yearlyXml=setFormulaCache(yearlyXml,`${column}${row}`,value);
    for(const [column,value] of [['N',sales],['O',purchasesTotal],['P',expenses],['Q',sales-purchasesTotal-expenses],['R',balances.total]] as const) setCalcValue(`${column}${month+1}`,value);
    const yearPeriodCriteria=`TEXT(DATE($B$3,${month},1),"yyyy-mm")`;
    const yearlyOperationsExpenses=`(${['Salary','Truck EMI','Auto EMI','Room Rent'].map(type=>`SUMIFS(${financeRange},${financeTypeRange},"${type}",${financePeriodRange},${yearPeriodCriteria})`).join('+')||'0'}-SUMIFS(${financeRange},${financeTypeRange},"Auto EMI Friend Share",${financePeriodRange},${yearPeriodCriteria}))`;
    const yearlyLoanRepayments=`SUMIFS(${financeRange},${financeTypeRange},"Loan Repayment",${financePeriodRange},">="&DATE($B$3,${month},1),${financePeriodRange},"<"&EDATE(DATE($B$3,${month},1),1))`;
    const dailyExpenseFormula=`SUMIFS('Daily Sales & Expenses'!$I$2:$I$${dailyLimit},'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},">="&DATE($B$3,${month},1),'Daily Sales & Expenses'!$A$2:$A$${dailyLimit},"<"&EDATE(DATE($B$3,${month},1),1))`;
    yearlyXml=setFormulaCell(yearlyXml,`D${row}`,`${dailyExpenseFormula}+${yearlyOperationsExpenses}+${yearlyLoanRepayments}`,expenses);
    yearlyXml=setFormulaCell(yearlyXml,`E${row}`,`B${row}-C${row}-D${row}`,sales-purchasesTotal-expenses);
    const balanceDateCriteria=`"<"&EDATE(DATE($B$3,${month},1),1)`;
    yearlyXml=setFormulaCell(yearlyXml,`F${row}`,`${onlineBalanceThrough(balanceDateCriteria)}+${cashBalanceThrough(balanceDateCriteria)}+(${vendorRefundsThrough(balanceDateCriteria)})`,balances.total);
  }
  const annualClosing=balanceThrough(`${selectedYearlyYear}-12-31`,daily,purchases,{online:settings.openingOnlineBalance,cash:settings.openingCashBalance},finance.months,finance.vendorReturns,finance.loans);
  for(const [ref,value] of Object.entries({B18:annualSales,C18:annualPurchases,D18:annualExpenses,E18:annualNet,F18:annualClosing.total})) yearlyXml=setFormulaCache(yearlyXml,ref,value);
  zip.file('xl/worksheets/sheet2.xml',yearlyXml);
  const savingsBalance=(finance.months||[]).reduce((balance,entry)=>balance+Number(entry.savingsDeposit||0)+(entry.savingsEntries||[]).reduce((total,item)=>total+Number(item.amount||0),0)-(entry.partnerPayments||[]).reduce((total,item)=>total+Number(item.amount||0),0),0);
  const loanOutstanding=(finance.loans||[]).reduce((total,loan)=>total+Math.max(0,Number(loan.amountTaken||0)-(loan.repayments||[]).reduce((repaid,item)=>repaid+Number(item.amount||0),0)),0);
  const vendorCreditsPending=Math.max(0,(finance.vendorReturns||[]).reduce((total,item)=>total+Number(item.amount||0)-(item.receipts||[]).reduce((received,receipt)=>received+Number(receipt.amount||0),0),0));
  const vendorCreditsReceived= (finance.vendorReturns||[]).flatMap(item=>item.receipts||[]).filter(receipt=>receipt.date>=periodStart&&receipt.date<periodEnd).reduce((total,receipt)=>total+Number(receipt.amount||0),0);
  const monthlyAnalyticsRows:Array<Array<string|number>>=[
    ['Selected period',`${MONTHS[selectedMonth-1]} ${monthlySelectedYear}`],
    ['Online sales',monthlySummaryValues.B5],
    ['Cash sales',monthlySummaryValues.B6],
    ['Total sales',monthlySummaryValues.B7],
    ['Total purchases',totalPurchases],
    ['Purchases paid online',monthPurchases.reduce((total,item)=>total+Number(item.onlinePurchasePaid||0),0)],
    ['Purchases paid cash',monthPurchases.reduce((total,item)=>total+Number(item.cashPurchasePaid||0),0)],
    ['Pending purchases',monthPurchases.reduce((total,item)=>total+Object.values(item.vendorAmounts||{}).reduce((sum,value)=>sum+Number(value||0),0)-Number(item.onlinePurchasePaid||0)-Number(item.cashPurchasePaid||0),0)],
    ['Daily expenses',dailyExpenses],
    ['Salaries',monthlySalary],
    ['Truck EMI',Number(monthFinance?.truckEmi||0)],
    ['Auto EMI (full)',Number(monthFinance?.autoEmi||0)],
    ['Auto EMI paid by friend',Number(monthFinance?.autoEmiFriendShare||0)],
    ['Auto EMI business share',autoEmiBusinessShare],
    ['Room rent',Number(monthFinance?.roomRent||0)],
    ['Loan repayments',monthlyLoanRepayments],
    ['Total expenses',totalExpenses],
    ['Net amount',totalSales-totalPurchases-totalExpenses],
    ['Opening online balance',openingBalances.online],
    ['Closing online balance',closingBalances.online],
    ['Opening cash balance',openingBalances.cash],
    ['Closing cash balance',closingBalances.cash],
    ['Closing total balance',closingBalances.total],
    ['Current loan outstanding',loanOutstanding],
    ['Vendor credits pending',vendorCreditsPending],
    ['Vendor credits received this month',vendorCreditsReceived]
  ];
  const expenseAnalyticsRows:Array<Array<string|number>>=[
    ...expenseCategories.filter(category=>category!=='Salary').map(category=>[category,monthDaily.reduce((total,entry)=>total+Number(entry.expenses?.[category]||0),0)]),
    ['Salary',monthlySalary+monthDaily.reduce((total,entry)=>total+Number(entry.expenses?.Salary||0),0)],
    ['Truck EMI',Number(monthFinance?.truckEmi||0)],
    ['Auto EMI',autoEmiBusinessShare],
    ['Room rent',Number(monthFinance?.roomRent||0)],
    ['Loan repayment',monthlyLoanRepayments]
  ];
  const vendorAnalyticsRows=allPurchaseCategories.map(vendor=>[
    vendor,
    monthPurchases.reduce((total,entry)=>total+Number(entry.vendorAmounts?.[vendor]||0),0)
  ]);
  const expenseAnalysisRows=expenseCategories.map(category=>({
    category,
    amount:monthDaily.reduce((total,entry)=>total+Number(entry.expenses?.[category]||0),0)
  })).filter(item=>item.amount>0).sort((a,b)=>b.amount-a.amount);
  if(!expenseAnalysisRows.length) expenseAnalysisRows.push({category:'No expenses',amount:0});
  const expenseAnalysisTableRows=expenseAnalysisRows.map(item=>[
    item.category,
    item.amount,
    `${dailyExpenses>0?(item.amount/dailyExpenses*100).toFixed(1):'0.0'}%`
  ]);
  const formatRatio=(part:number,total:number)=>`${total>0?(part/total*100).toFixed(1):'0.0'}%`;
  const pendingPurchases=monthPurchases.reduce((total,item)=>
    total+Math.max(0,Object.values(item.vendorAmounts||{}).reduce((sum,value)=>sum+Number(value||0),0)-Number(item.onlinePurchasePaid||0)-Number(item.cashPurchasePaid||0)),0);
  const selectedMonthEnd=new Date(Date.UTC(monthlySelectedYear,selectedMonth,0)).toISOString().slice(0,10);
  const previousMonthDate=new Date(Date.UTC(monthlySelectedYear,selectedMonth-2,1));
  const previousMonthStart=previousMonthDate.toISOString().slice(0,10);
  const previousMonthEnd=new Date(Date.UTC(previousMonthDate.getUTCFullYear(),previousMonthDate.getUTCMonth()+1,1)).toISOString().slice(0,10);
  const previousMonthPeriod=previousMonthStart.slice(0,7);
  const summarizePeriod=(start:string,end:string,period:string)=>{
    const periodDaily=daily.filter(entry=>entry.date>=start&&entry.date<end);
    const periodPurchases=purchases.filter(entry=>entry.purchaseDate>=start&&entry.purchaseDate<end);
    const periodFinance=(finance.months||[]).find(entry=>entry.period===period);
    const sales=periodDaily.reduce((sum,entry)=>sum+Number(entry.onlineSales||0)+Number(entry.cashSales||0),0);
    const purchaseTotal=periodPurchases.reduce((sum,entry)=>sum+Object.values(entry.vendorAmounts||{}).reduce((amount,value)=>amount+Number(value||0),0),0);
    const operations=(periodFinance?.salaries||[]).reduce((sum,item)=>sum+Number(item.amount||0),0)
      +Number(periodFinance?.truckEmi||0)+Math.max(0,Number(periodFinance?.autoEmi||0)-Number(periodFinance?.autoEmiFriendShare||0))+Number(periodFinance?.roomRent||0);
    const loanPayments=(finance.loans||[]).flatMap(loan=>loan.repayments||[])
      .filter(item=>item.date>=start&&item.date<end).reduce((sum,item)=>sum+Number(item.amount||0),0);
    const expenses=periodDaily.reduce((sum,entry)=>sum+Object.values(entry.expenses||{}).reduce((amount,value)=>amount+Number(value||0),0),0)+operations+loanPayments;
    return {sales,purchases:purchaseTotal,expenses,net:sales-purchaseTotal-expenses};
  };
  const currentMonthSummary={sales:totalSales,purchases:totalPurchases,expenses:totalExpenses,net:totalSales-totalPurchases-totalExpenses};
  const previousMonthSummary=summarizePeriod(previousMonthStart,previousMonthEnd,previousMonthPeriod);
  const comparisonRows=(Object.keys(currentMonthSummary) as Array<keyof typeof currentMonthSummary>).map(metric=>{
    const current=currentMonthSummary[metric],previous=previousMonthSummary[metric],difference=current-previous;
    return [metric==='sales'?'Sales':metric==='purchases'?'Purchases':metric==='expenses'?'Expenses':'Net Amount',current,previous,difference,previous===0?'N/A':`${(difference/Math.abs(previous)*100).toFixed(1)}%`];
  });
  const yearToDate=currentMonthSummary;
  for(let month=1;month<selectedMonth;month++){
    const start=`${monthlySelectedYear}-${String(month).padStart(2,'0')}-01`;
    const end=new Date(Date.UTC(monthlySelectedYear,month,1)).toISOString().slice(0,10);
    const period=summarizePeriod(start,end,start.slice(0,7));
    yearToDate.sales+=period.sales;
    yearToDate.purchases+=period.purchases;
    yearToDate.expenses+=period.expenses;
    yearToDate.net+=period.net;
  }
  const ytdRows:Array<Array<string|number>>=[
    ['Year-to-date sales',yearToDate.sales],
    ['Year-to-date purchases',yearToDate.purchases],
    ['Year-to-date expenses',yearToDate.expenses],
    ['Year-to-date net amount',yearToDate.net],
    ['Closing total balance',closingBalances.total]
  ];
  const dailyOnlineExpensePayments=monthDaily.reduce((sum,entry)=>sum+Number(entry.expensePaidOnline||0),0);
  const dailyCashExpensePayments=monthDaily.reduce((sum,entry)=>sum+Number(entry.expensePaidCash||0),0);
  const periodFinanceRecords=(finance.months||[]).filter(item=>item.period===`${monthlySelectedYear}-${String(selectedMonth).padStart(2,'0')}`);
  const financeOnlinePayments=periodFinanceRecords.reduce((sum,item)=>{
    const [year,month]=item.period.split('-').map(Number);
    const financeMonthEnd=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
    return sum
      +(item.salaries||[]).filter(salary=>(salary.paymentDate||financeMonthEnd)>=periodStart&&(salary.paymentDate||financeMonthEnd)<periodEnd).reduce((amount,salary)=>amount+Number(salary.amount||0),0)
      +((item.truckEmiPaymentDate||financeMonthEnd)>=periodStart&&(item.truckEmiPaymentDate||financeMonthEnd)<periodEnd?Number(item.truckEmi||0):0)
      +((item.autoEmiPaymentDate||financeMonthEnd)>=periodStart&&(item.autoEmiPaymentDate||financeMonthEnd)<periodEnd?Math.max(0,Number(item.autoEmi||0)-Number(item.autoEmiFriendShare||0)):0)
      +((item.roomRentPaymentDate||`${item.period}-01`)>=periodStart&&(item.roomRentPaymentDate||`${item.period}-01`)<periodEnd?Number(item.roomRent||0):0);
  },0);
  const financeRepaymentPayments=(finance.loans||[]).flatMap(loan=>loan.repayments||[])
    .filter(item=>item.date>=periodStart&&item.date<periodEnd).reduce((sum,item)=>sum+Number(item.amount||0),0);
  const onlineExpensePayments=dailyOnlineExpensePayments+financeOnlinePayments+financeRepaymentPayments;
  const cashExpensePayments=dailyCashExpensePayments;
  const allExpensePayments=onlineExpensePayments+cashExpensePayments;
  const percentOfPaidExpenses=(amount:number)=>allExpensePayments>0?`${(amount/allExpensePayments*100).toFixed(1)}%`:'0.0%';
  const expensePaymentRows:Array<Array<string|number>>=[
    ['Daily expenses - online',dailyOnlineExpensePayments,percentOfPaidExpenses(dailyOnlineExpensePayments)],
    ['Daily expenses - cash',dailyCashExpensePayments,percentOfPaidExpenses(dailyCashExpensePayments)],
    ['Salary, EMI, rent & loan repayment - online',financeOnlinePayments+financeRepaymentPayments,percentOfPaidExpenses(financeOnlinePayments+financeRepaymentPayments)],
    ['Total online / bank',onlineExpensePayments,percentOfPaidExpenses(onlineExpensePayments)],
    ['Total cash',cashExpensePayments,percentOfPaidExpenses(cashExpensePayments)],
    ['Total expenses paid',allExpensePayments,'100.0%']
  ];
  const topVendorRows=allPurchaseCategories.map(vendor=>({
    vendor,
    amount:monthPurchases.reduce((sum,entry)=>sum+Number(entry.vendorAmounts?.[vendor]||0),0)
  })).filter(item=>item.amount>0).sort((a,b)=>b.amount-a.amount).slice(0,10)
    .map(item=>[item.vendor,item.amount,totalPurchases>0?`${(item.amount/totalPurchases*100).toFixed(1)}%`:'0.0%']);
  if(!topVendorRows.length) topVendorRows.push(['No vendor purchases',0,'0.0%']);
  const reconciliation=(finance.reconciliations||[]).filter(item=>item.date<=selectedMonthEnd).sort((a,b)=>b.date.localeCompare(a.date))[0];
  const reconciliationRows:Array<Array<string|number>>=reconciliation?[
    ['Online',reconciliation.actualOnline,reconciliation.bookOnline,reconciliation.varianceOnline,reconciliation.varianceOnline===0?'MATCH':'CHECK'],
    ['Cash',reconciliation.actualCash,reconciliation.bookCash,reconciliation.varianceCash,reconciliation.varianceCash===0?'MATCH':'CHECK'],
    ['As of date',reconciliation.date,'','','']
  ]:[
    ['Status','No saved reconciliation through selected month-end','','',''],
    ['As of date',selectedMonthEnd,'','','']
  ];
  const monthlySavingsDeposit=Number(monthFinance?.savingsDeposit||0);
  const datedSavingsDeposits=monthFinance?.savingsEntries||[];
  const monthlyPartnerPayouts=(monthFinance?.partnerPayments||[]).reduce((total,payment)=>total+Number(payment.amount||0),0);
  const savingsRows:Array<Array<string|number>>=[
    ['Deposited this month','','',monthlySavingsDeposit+datedSavingsDeposits.reduce((total,item)=>total+Number(item.amount||0),0)],
    ['Current savings balance','','',savingsBalance],
    ...(
      monthlySavingsDeposit>0
        ?[['Monthly deposit',selectedMonthEnd,'Monthly savings deposit',monthlySavingsDeposit] as Array<string|number>]
        :[]
    ),
    ...datedSavingsDeposits.map(item=>['Dated deposit',item.date,item.note||'Savings deposit',Number(item.amount||0)]),
    ...(
      monthlyPartnerPayouts>0
        ?[['Partner payouts',selectedMonthEnd,'Paid from savings',-monthlyPartnerPayouts] as Array<string|number>]
        :[]
    )
  ];
  const includeReconciliation=finance.reconciliations!==undefined;
  const reconciliationStartRow=Math.max(
    55,
    42+expenseAnalyticsRows.length,
    42+vendorAnalyticsRows.length,
    12+monthlyAnalyticsRows.length
  );
  const topVendorsStartRow=reconciliationStartRow+Math.max(reconciliationRows.length,expensePaymentRows.length)+4;
  const monthComparisonStartRow=topVendorsStartRow+Math.max(topVendorRows.length,ytdRows.length)+4;
  const analyticsSections:AnalyticsSection[]=[
    {
      title:'KEY PERFORMANCE RATIOS',
      headers:['Metric','Value'],
      rows:[
        ['Sales vs Purchases',formatRatio(totalPurchases,totalSales)],
        ['Sales vs Expenses',formatRatio(totalExpenses,totalSales)],
        ['Net Margin',formatRatio(totalSales-totalPurchases-totalExpenses,totalSales)]
      ],
      startColumn:0,
      startRow:3
    },
    {
      title:'CURRENT BALANCES & PAYMENTS',
      headers:['Metric','Amount'],
      rows:[
        ['Online Balance',closingBalances.online],
        ['Cash Balance',closingBalances.cash],
        ['Total Balance',closingBalances.total],
        ['Pending Purchases',pendingPurchases]
      ],
      startColumn:4,
      startRow:3
    },
    {
      title:'EXPENSE ANALYSIS',
      headers:['Category','Amount','% of Expenses'],
      rows:expenseAnalysisTableRows,
      startColumn:0,
      startRow:10
    },
    {
      title:'Selected Month Summary',
      headers:['Metric','Value'],
      rows:monthlyAnalyticsRows,
      startColumn:4,
      startRow:10
    },
    {
      title:'MONTH-OVER-MONTH COMPARISON',
      headers:['Metric',`${MONTHS[selectedMonth-1]} ${monthlySelectedYear}`,`${MONTHS[previousMonthDate.getUTCMonth()]} ${previousMonthDate.getUTCFullYear()}`,'Change','Change %'],
      rows:comparisonRows,
      startColumn:0,
      startRow:monthComparisonStartRow
    },
    ...(includeReconciliation?[{
      title:'RECONCILIATION CHECK',
      headers:['Account','Verified Balance','Book Balance','Difference','Status'],
      rows:reconciliationRows,
      startColumn:0,
      startRow:reconciliationStartRow
    }]:[]),
    {
      title:'EXPENSES BY PAYMENT SOURCE',
      headers:['Payment Source','Amount','% of Paid Expenses'],
      rows:expensePaymentRows,
      startColumn:6,
      startRow:reconciliationStartRow
    },
    {
      title:'TOP VENDORS',
      headers:['Vendor','Purchase Amount','% of Purchases'],
      rows:topVendorRows,
      startColumn:0,
      startRow:topVendorsStartRow
    },
    {
      title:'YEAR-TO-DATE TOTALS',
      headers:['Metric','Amount'],
      rows:ytdRows,
      startColumn:6,
      startRow:topVendorsStartRow
    },
    {
      title:'SAVINGS DEPOSITS & BALANCE',
      headers:['Type','Date','Note','Amount'],
      rows:savingsRows,
      startColumn:7,
      startRow:monthComparisonStartRow+comparisonRows.length+4
    },
    {
      title:'Selected Month Expense Breakdown',
      headers:['Expense Category','Amount'],
      rows:expenseAnalyticsRows,
      startColumn:0,
      startRow:monthComparisonStartRow+comparisonRows.length+4
    },
    {
      title:'Selected Month Vendor Purchases',
      headers:['Vendor','Purchase Amount'],
      rows:vendorAnalyticsRows,
      startColumn:4,
      startRow:monthComparisonStartRow+comparisonRows.length+4
    },
    {title:`${selectedYearlyYear} Monthly Analytics`,headers:['Month','Sales','Purchases','Expenses','Net Amount','Closing Balance'],rows:yearlyAnalyticsRows},
    {title:`${selectedYearlyYear} Annual Totals`,headers:['Metric','Value'],rows:[['Annual sales',annualSales],['Annual purchases',annualPurchases],['Annual expenses',annualExpenses],['Annual net amount',annualNet],['Year-end closing balance',annualClosing.total]]}
  ];
  const analyticsSheet=buildAnalyticsSheet(analyticsSections);
  const analyticsRange=(section:string,column:string,firstOffset=0,lastOffset?:number)=>{
    const rows=analyticsSheet.sectionRows[section];
    if(!rows||rows.end<rows.start) return null;
    const first=rows.start+firstOffset,last=lastOffset===undefined?rows.end:Math.min(rows.end,rows.start+lastOffset);
    return first<=last?`Analytics!$${column}$${first}:$${column}$${last}`:null;
  };
  const analyticsCharts:AnalyticsChart[]=[];
  const monthSummaryTitle='Selected Month Summary';
  const monthExpenseTitle='Selected Month Expense Breakdown';
  const vendorTitle='Selected Month Vendor Purchases';
  const monthSummaryCategories=analyticsRange(monthSummaryTitle,'E',1,2);
  const monthSummaryValues=analyticsRange(monthSummaryTitle,'F',1,2);
  const annualTotalsTitle=`${selectedYearlyYear} Annual Totals`;
  const annualCategories=analyticsRange(annualTotalsTitle,'A',0,2);
  const annualValues=analyticsRange(annualTotalsTitle,'B',0,2);
  const expenseCategoriesRange=analyticsRange(monthExpenseTitle,'A');
  const expenseValuesRange=analyticsRange(monthExpenseTitle,'B');
  const vendorCategoriesRange=analyticsRange(vendorTitle,'E');
  const vendorValuesRange=analyticsRange(vendorTitle,'F');
  const monthlyTrendsTitle=`${selectedYearlyYear} Monthly Analytics`;
  const monthLabels=analyticsRange(monthlyTrendsTitle,'A');
  const monthColumns=['B','C','D','E','F'];
  if(monthSummaryCategories&&monthSummaryValues) analyticsCharts.push({templateNumber:1,formulas:[monthSummaryCategories,monthSummaryValues]});
  if(annualCategories&&annualValues) analyticsCharts.push({templateNumber:2,formulas:[annualCategories,annualValues]});
  if(expenseCategoriesRange&&expenseValuesRange) analyticsCharts.push({templateNumber:2,formulas:[expenseCategoriesRange,expenseValuesRange],title:'Selected Month Expense Breakdown'});
  if(vendorCategoriesRange&&vendorValuesRange) analyticsCharts.push({templateNumber:3,formulas:[vendorCategoriesRange,vendorValuesRange]});
  if(monthLabels){
    monthColumns.forEach((column,index)=>{
      const values=analyticsRange(monthlyTrendsTitle,column);
      if(!values) return;
      const formulas:string[]=[];
      for(let series=0;series<=index;series++) formulas.push(monthLabels,analyticsRange(monthlyTrendsTitle,monthColumns[series])!);
      analyticsCharts.push({templateNumber:index+4,formulas});
    });
  }
  for(const [ref,value] of analyticsSheet.cellValues) calcValues.set(ref,value);
  await appendAnalyticsSheet(zip,analyticsSheet,analyticsCharts);
  for(let month=1;month<=12;month++) setCalcValue(`M${month+1}`,MONTHS[month-1]);
  for(const [ref,value] of calcValues) calcXml=typeof value==='number'?setFormulaCache(calcXml,ref,value):setCalcCachedText(calcXml,ref,value);
  zip.file('xl/worksheets/sheet7.xml',calcXml);
  dashboardXml=setCellValue(dashboardXml,'B3',MONTHS[selectedMonth-1]);
  dashboardXml=setCellValue(dashboardXml,'D3',monthlySelectedYear);
  zip.file(dashboardPath,dashboardXml);
  summaryXml=setFormulaCache(summaryXml,'B3',excelSerial(periodStart)||0);
  zip.file(monthlySummaryPath,summaryXml);
  for(const name of Object.keys(zip.files).filter(file=>/^xl\/charts\/chart\d+\.xml$/.test(file))){
    const chart=zip.file(name);
    if(chart) zip.file(name,refreshChartCaches(await chart.async('string'),calcValues));
  }
  const wbXml=await zip.file('xl/workbook.xml')!.async('string');
  const calcPr = '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>';
  const wbPatched = wbXml.includes('<calcPr') ? wbXml.replace(/<calcPr[^>]*\/>/, calcPr) : wbXml.replace('</workbook>', calcPr + '</workbook>');
  zip.file('xl/workbook.xml', wbPatched);
  zip.remove('xl/calcChain.xml');
  const relationshipsPath='xl/_rels/workbook.xml.rels';
  const relationships=await zip.file(relationshipsPath)!.async('string');
  zip.file(relationshipsPath,relationships.replace(/<Relationship\b(?=[^>]*\bType="[^"]*\/calcChain")[^>]*\/>/g,''));
  const contentTypesPath='[Content_Types].xml';
  const contentTypes=await zip.file(contentTypesPath)!.async('string');
  zip.file(contentTypesPath,contentTypes.replace(/<Override\b(?=[^>]*\bPartName="\/xl\/calcChain\.xml")[^>]*\/>/g,''));
  return zip.generateAsync({type:'nodebuffer'});
}

export async function exportWorkbook(options:{includeReconciliation?:boolean}={}): Promise<Buffer> {
  const db=await getDb();
  const business = await db.collection<{_id:string;name?:string;openingOnlineBalance?:number;openingCashBalance?:number;vendors?:string[];expenseCategories?:string[]}>('businesses').findOne({_id:BUSINESS_ID});
  const daily=await db.collection<DailyEntry>('dailyEntries').find({businessId:BUSINESS_ID}).sort({date:1}).toArray();
  const purchases=await db.collection<PurchaseEntry>('purchaseEntries').find({businessId:BUSINESS_ID}).sort({purchaseDate:1}).toArray();
  const [rent, distributions] = await Promise.all([
    db.collection<{period:string;amount:number;paymentDate:string;status:string;notes:string}>('rentPayments')
      .find({businessId:BUSINESS_ID}).sort({period:1}).toArray(),
    db.collection<{
      period:string;
      approvedAmount:number;
      friendAllocation:number;
      investorAllocation:number;
      investor1Percent?:number;
      investor2Percent?:number;
      payments:Array<{recipient:string;amount:number;paymentDate:string;note?:string}>;
      notes:string;
    }>('partnerDistributions').find({businessId:BUSINESS_ID}).sort({period:1}).toArray()
  ]);
  const reconciliationQuery=options.includeReconciliation
    ?db.collection<ReconciliationExport & {businessId:string}>('accountReconciliations').find({businessId:BUSINESS_ID}).sort({date:-1}).toArray()
    :Promise.resolve(undefined);
  const reconciliations=await reconciliationQuery;
  const settings: BusinessSettings={name:business?.name||'CONIC',currency:'INR',dateFormat:'DD-MMM-YYYY',openingOnlineBalance:Number(business?.openingOnlineBalance||0),openingCashBalance:Number(business?.openingCashBalance||0),vendors:Array.isArray(business?.vendors)&&business.vendors.length?business.vendors:DEFAULT_VENDORS,expenseCategories:Array.isArray(business?.expenseCategories)&&business.expenseCategories.length?business.expenseCategories:DEFAULT_EXPENSE_CATEGORIES};
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
    ['Business Name',settings.name],
    ['Business ID',BUSINESS_ID],
    ['Opening Online Balance',settings.openingOnlineBalance],
    ['Opening Cash Balance',settings.openingCashBalance],
    [],
    ['Vendors',...settings.vendors],
    ['Expense Categories',...settings.expenseCategories]
  ]),'Settings');

  const expenseCategories=[...new Set([...settings.expenseCategories,...daily.flatMap(entry=>Object.keys(entry.expenses||{}))])];
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
    ['Date','Online Sales','Cash Sales',...expenseCategories,'Expense Paid Online','Expense Paid Cash','Notes'],
    ...daily.map(entry=>[
      entry.date,entry.onlineSales,entry.cashSales,
      ...expenseCategories.map(name=>Number(entry.expenses?.[name]||0)),
      entry.expensePaidOnline,entry.expensePaidCash,entry.notes||''
    ])
  ]),'Daily Sales & Expenses');

  const vendors=[...new Set([...settings.vendors,...purchases.flatMap(entry=>Object.keys(entry.vendorAmounts||{}))])];
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
    ['Purchase Date','Payment Date',...vendors,'Online Purchase Paid','Cash Purchase Paid'],
    ...purchases.map(entry=>[
      entry.purchaseDate,entry.paymentDate||'',
      ...vendors.map(name=>Number(entry.vendorAmounts?.[name]||0)),
      entry.onlinePurchasePaid,entry.cashPurchasePaid
    ])
  ]),'Weekly Purchases');

  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
    ['Month','Rent Amount','Payment Date','Status','Notes'],
    ...rent.map(entry=>[entry.period,entry.amount,entry.paymentDate,entry.status,entry.notes])
  ]),'Rent');
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
    ['Month','Approved Amount','Friend Allocation','Investors Collective Allocation','Investor 1 Pool Share (%)','Investor 2 Pool Share (%)','Recipient','Payment Amount','Payment Date','Payment Note','Approval Notes'],
    ...distributions.flatMap(entry=>(entry.payments||[]).length
      ? entry.payments.map(payment=>[entry.period,entry.approvedAmount,entry.friendAllocation,entry.investorAllocation,entry.investor1Percent??'',entry.investor2Percent??'',payment.recipient,payment.amount,payment.paymentDate,payment.note||'',entry.notes])
      : [[entry.period,entry.approvedAmount,entry.friendAllocation,entry.investorAllocation,entry.investor1Percent??'',entry.investor2Percent??'','','','','',entry.notes]])
  ]),'Partner Payments');
  if(reconciliations) XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(reconciliations),'Reconciliation');
  return XLSX.write(workbook,{bookType:'xlsx',type:'buffer'}) as Buffer;
}
