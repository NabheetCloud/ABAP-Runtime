@EndUserText.label : 'G/L accounts (company code)'
define table skb1 {
  key mandt : abap.clnt not null;
  key bukrs : abap.char(4) not null;
  key saknr : abap.char(10) not null;
  waers     : abap.cuky;
  mitkz     : abap.char(1);
  xspeb     : abap.char(1);
  xopvw     : abap.char(1);
  xkres     : abap.char(1);
  fstag     : abap.char(20);
  zuawa     : abap.char(20);
  begru     : abap.char(20);
  busab     : abap.char(20);
  xintb     : abap.char(1);
}
