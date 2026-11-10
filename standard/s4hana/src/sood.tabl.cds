@EndUserText.label : 'Office documents'
define table sood {
  key mandt    : abap.clnt not null;
  key objtp    : abap.char(3) not null;
  key objyr    : abap.char(2) not null;
  key objno    : abap.char(12) not null;
  objdes       : abap.char(50);
  file_ext     : abap.char(3);
  crdat        : abap.dats;
  objla        : abap.char(20);
  objlen       : abap.int4;
  ownnam       : abap.char(20);
}
