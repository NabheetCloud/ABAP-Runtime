@EndUserText.label : 'G/L accounts (chart of accounts)'
define table ska1 {
  key mandt          : abap.clnt not null;
  key ktopl          : abap.char(4) not null;
  key saknr          : abap.char(10) not null;
  xbilk              : abap.char(1);
  gvtyp              : abap.char(2);
  ktoks              : abap.char(4);
  glaccount_type     : abap.char(1);
  xspeb              : abap.char(1);
  xspea              : abap.char(1);
}
