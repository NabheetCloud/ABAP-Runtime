@EndUserText.label : 'Depreciation terms'
define table anlb {
  key mandt : abap.clnt not null;
  key bukrs : abap.char(4) not null;
  key anln1 : abap.char(12) not null;
  key anln2 : abap.char(4) not null;
  key afabe : abap.numc(2) not null;
  key bdatu : abap.dats not null;
  afasl     : abap.char(20);
  ndjar     : abap.dec(15,3);
  ndper     : abap.dec(15,3);
  afabg     : abap.dats;
}
