@EndUserText.label : 'CRCA'
define table crca {
  key mandt : abap.clnt not null;
  key objty : abap.char(2) not null;
  key objid : abap.char(8) not null;
  key canum : abap.char(20) not null;
  kapid     : abap.char(8);
  fork1     : abap.char(20);
  fork2     : abap.char(20);
}
